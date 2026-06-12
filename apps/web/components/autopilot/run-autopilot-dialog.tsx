"use client";

import * as React from "react";
import { Bot, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { api } from "@workspace/api-client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@workspace/ui/components";

const ALL_SOURCES = "__all__";

/**
 * Steer-and-run dialog: queue a manual autopilot cycle over EXISTING data
 * (all open findings, not just a scan delta) with an operator instruction
 * the agents must prioritise. Fully async — progress lands in the
 * Autopilot activity tab.
 */
export function RunAutopilotDialog({
  open,
  onOpenChange,
  defaultSourceId,
  onTriggered,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultSourceId?: string;
  onTriggered?: (cycleKey: string) => void;
}) {
  const [instruction, setInstruction] = React.useState("");
  const [sourceId, setSourceId] = React.useState(defaultSourceId ?? ALL_SOURCES);
  const [sources, setSources] = React.useState<Array<{ id: string; name: string }>>([]);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setSourceId(defaultSourceId ?? ALL_SOURCES);
    api.sources
      .sourcesControllerListSources()
      .then((list) =>
        setSources(
          (Array.isArray(list) ? list : []).map((s) => ({
            id: s.id,
            name: s.name,
          })),
        ),
      )
      .catch(() => setSources([]));
  }, [open, defaultSourceId]);

  const run = async () => {
    try {
      setSubmitting(true);
      const res = await api.autopilot.autopilotControllerTrigger({
        triggerAutopilotDto: {
          instruction: instruction.trim() || undefined,
          sourceId: sourceId === ALL_SOURCES ? undefined : sourceId,
        },
      });
      toast.success("Autopilot cycle queued — watch it in Activity");
      onOpenChange(false);
      setInstruction("");
      onTriggered?.(res.cycleKey);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to queue the autopilot");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[6px] border-2 border-border sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-[#d97706]" />
            Run autopilot now
          </DialogTitle>
          <DialogDescription>
            Reviews all existing open findings — not just new ones — and manages
            inquiries and cases. Items set to “Observe only” are never touched.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-mono uppercase tracking-[0.12em]">
              What should it pay attention to?
            </Label>
            <Textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={4}
              maxLength={4000}
              placeholder="e.g. Create an inquiry for exposed database credentials if any exist, and check whether the PII findings in Confluence justify a case…"
              className="rounded-[4px] border-2 border-border text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              Optional — without an instruction the agents do a general review.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-mono uppercase tracking-[0.12em]">
              Scope
            </Label>
            <Select value={sourceId} onValueChange={setSourceId}>
              <SelectTrigger className="h-9 rounded-[4px] border-2 border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_SOURCES}>All sources</SelectItem>
                {sources.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => void run()} disabled={submitting}>
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Queue cycle
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
