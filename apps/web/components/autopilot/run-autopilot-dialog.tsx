"use client";

import * as React from "react";
import { Bot, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/use-translation";
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
const DREAM_AGENT = "__dream__";

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
  const { t } = useTranslation();
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
      if (!caseMode && agent === DREAM_AGENT) {
        const dream = await api.autopilot.autopilotControllerTriggerDream();
        toast.success(t("investigations.autopilot.runDialog.toastQueued"));
        onOpenChange(false);
        setInstruction("");
        onTriggered?.(dream.cycleKey);
        return;
      }
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
          ? t("investigations.autopilot.runDialog.toastCaseQueued")
          : t("investigations.autopilot.runDialog.toastQueued"),
      );
      onOpenChange(false);
      setInstruction("");
      onTriggered?.(res.cycleKey);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("investigations.autopilot.runDialog.toastError"));
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
            {caseMode ? t("investigations.autopilot.runDialog.titleCase") : t("investigations.autopilot.runDialog.titleGeneral")}
          </DialogTitle>
          <DialogDescription>
            {caseMode ? (
              <>
                {t("investigations.autopilot.runDialog.descCase", { title: caseTitle ?? "this case" })}
              </>
            ) : (
              t("investigations.autopilot.runDialog.descGeneral")
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-mono uppercase tracking-[0.12em]">
              {caseMode ? t("investigations.autopilot.runDialog.instructionLabelCase") : t("investigations.autopilot.runDialog.instructionLabelGeneral")}
            </Label>
            <Textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={4}
              maxLength={4000}
              placeholder={caseMode ? t("investigations.autopilot.runDialog.placeholderCase") : t("investigations.autopilot.runDialog.placeholderGeneral")}
              className="rounded-[4px] border-2 border-border text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              {caseMode
                ? t("investigations.autopilot.runDialog.instructionOptionalCase")
                : t("investigations.autopilot.runDialog.instructionOptionalGeneral")}
            </p>
          </div>

          {!caseMode && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-mono uppercase tracking-[0.12em]">
                  {t("investigations.autopilot.runDialog.agentLabel")}
                </Label>
                <Select value={agent} onValueChange={setAgent}>
                  <SelectTrigger className="h-9 rounded-[4px] border-2 border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={BOTH_AGENTS}>{t("investigations.autopilot.runDialog.agentBoth")}</SelectItem>
                    <SelectItem value={TriggerAutopilotDtoAgentKindEnum.Inquiry}>
                      {t("investigations.autopilot.runDialog.agentInquiryOnly")}
                    </SelectItem>
                    <SelectItem value={TriggerAutopilotDtoAgentKindEnum.Case}>
                      {t("investigations.autopilot.runDialog.agentCaseOnly")}
                    </SelectItem>
                    <SelectItem value={TriggerAutopilotDtoAgentKindEnum.Config}>
                      {t("harness.kinds.CONFIG")}
                    </SelectItem>
                    <SelectItem
                      value={TriggerAutopilotDtoAgentKindEnum.DetectorAuthor}
                    >
                      {t("harness.kinds.DETECTOR_AUTHOR")}
                    </SelectItem>
                    <SelectItem value={DREAM_AGENT}>
                      {t("harness.kinds.DREAM")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-mono uppercase tracking-[0.12em]">
                  {t("investigations.autopilot.runDialog.scopeLabel")}
                </Label>
                <Select value={sourceId} onValueChange={setSourceId}>
                  <SelectTrigger className="h-9 rounded-[4px] border-2 border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_SOURCES}>{t("investigations.autopilot.runDialog.scopeAllSources")}</SelectItem>
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
              {t("investigations.autopilot.runDialog.cancel")}
            </Button>
            <Button onClick={() => void run()} disabled={submitting}>
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {caseMode ? t("investigations.autopilot.runDialog.submitCase") : t("investigations.autopilot.runDialog.submitGeneral")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
