"use client";

import * as React from "react";
import { Bot, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { api, TriggerAutopilotDtoAgentKindEnum } from "@workspace/api-client";
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
const BOTH_AGENTS = "__both__";

const CASE_PLACEHOLDER =
  "e.g. Connect the findings that share the same credential value with edges, build the evidence path from the HR export to the public wiki page, and update the exfiltration hypothesis with whatever supports or contradicts it…";
const GENERAL_PLACEHOLDER =
  "e.g. Create an inquiry for exposed database credentials if any exist, and check whether the PII findings in Confluence justify a case…";

/**
 * Steer-and-run dialog: queue a manual autopilot cycle over EXISTING data
 * (all open findings, not just a scan delta) with an operator instruction
 * the agents must prioritise. Two shapes:
 *  - general run (optionally scoped to a source, optionally one agent)
 *  - case-focused run (caseId set): the case agent receives the full case
 *    detail and can connect/disconnect edges, build evidence paths and
 *    create/update hypotheses with supporting evidence.
 * Fully async — progress lands in the Autopilot activity tab (and on the
 * case page for focused runs).
 */
export function RunAutopilotDialog({
  open,
  onOpenChange,
  defaultSourceId,
  caseId,
  caseTitle,
  onTriggered,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultSourceId?: string;
  /** Focus the run on one case — hides scope, implies the case agent. */
  caseId?: string;
  caseTitle?: string;
  onTriggered?: (cycleKey: string) => void;
}) {
  const caseMode = Boolean(caseId);
  const [instruction, setInstruction] = React.useState("");
  const [sourceId, setSourceId] = React.useState(defaultSourceId ?? ALL_SOURCES);
  const [agent, setAgent] = React.useState<string>(BOTH_AGENTS);
  const [sources, setSources] = React.useState<Array<{ id: string; name: string }>>([]);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open || caseMode) return;
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
  }, [open, defaultSourceId, caseMode]);

  const run = async () => {
    try {
      setSubmitting(true);
      const res = await api.autopilot.autopilotControllerTrigger({
        triggerAutopilotDto: {
          instruction: instruction.trim() || undefined,
          sourceId: caseMode || sourceId === ALL_SOURCES ? undefined : sourceId,
          caseId: caseId || undefined,
          agentKind:
            caseMode || agent === BOTH_AGENTS
              ? undefined
              : (agent as TriggerAutopilotDtoAgentKindEnum),
        },
      });
      toast.success(
        caseMode
          ? "AI is working on this case — results appear here when done"
          : "Autopilot cycle queued — watch it in Activity",
      );
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
            {caseMode ? "Run AI on this case" : "Run autopilot now"}
          </DialogTitle>
          <DialogDescription>
            {caseMode ? (
              <>
                The case agent works on{" "}
                <span className="font-medium text-foreground">{caseTitle ?? "this case"}</span>{" "}
                with its full detail: it can connect or disconnect edges, build evidence
                paths, and create or update hypotheses with supporting evidence. Describe
                what you want in plain language — the AI resolves the targets itself.
              </>
            ) : (
              <>
                Reviews all existing open findings — not just new ones — and manages
                inquiries and cases. Items set to “Observe only” are never touched.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-mono uppercase tracking-[0.12em]">
              {caseMode ? "What should it do on this case?" : "What should it pay attention to?"}
            </Label>
            <Textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={4}
              maxLength={4000}
              placeholder={caseMode ? CASE_PLACEHOLDER : GENERAL_PLACEHOLDER}
              className="rounded-[4px] border-2 border-border text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              {caseMode
                ? "Optional — without an instruction the agent does whatever most advances the investigation."
                : "Optional — without an instruction the agents do a general review."}
            </p>
          </div>

          {!caseMode && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-mono uppercase tracking-[0.12em]">
                  Agent
                </Label>
                <Select value={agent} onValueChange={setAgent}>
                  <SelectTrigger className="h-9 rounded-[4px] border-2 border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={BOTH_AGENTS}>Both agents</SelectItem>
                    <SelectItem value={TriggerAutopilotDtoAgentKindEnum.Inquiry}>
                      Inquiry agent only
                    </SelectItem>
                    <SelectItem value={TriggerAutopilotDtoAgentKindEnum.Case}>
                      Case agent only
                    </SelectItem>
                  </SelectContent>
                </Select>
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
            </div>
          )}

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
              {caseMode ? "Run on case" : "Queue cycle"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
