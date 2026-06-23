"use client";

import * as React from "react";
import { Bot, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/use-translation";
import { api, TriggerAutopilotDtoAgentKindsEnum as Kind } from "@workspace/api-client";
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
import { Checkbox } from "@workspace/ui/components/checkbox";
import { cn } from "@workspace/ui/lib/utils";

const ALL_SOURCES = "__all__";

/** Pipeline agents run in canonical order as one chained cycle. */
const PIPELINE_AGENTS = [
  { kind: Kind.Inquiry, key: "inquiry" },
  { kind: Kind.Case, key: "case" },
  { kind: Kind.Config, key: "config" },
  { kind: Kind.DetectorAuthor, key: "detector" },
] as const;

/** Global maintenance agents run as their own jobs. */
const GLOBAL_AGENTS = [
  { kind: Kind.Dream, key: "dream" },
  { kind: Kind.Duplicates, key: "duplicates" },
] as const;

const PIPELINE_KINDS = PIPELINE_AGENTS.map((a) => a.kind);
const ORDERED = [...PIPELINE_AGENTS, ...GLOBAL_AGENTS];

/**
 * Steer-and-run dialog: queue a manual autopilot cycle over EXISTING data
 * (all open findings, not just a scan delta) with an operator instruction the
 * agents prioritise. Two shapes:
 *  - general run: pick any agents to run. Pipeline agents (Inquiry, Case,
 *    Config, Detector) run in order as one chained cycle; Dream (steered by the
 *    instruction) and Duplicates (deterministic fingerprint consolidation) run
 *    as their own jobs. Optionally scope to a source.
 *  - case-focused run (caseId set): the case agent receives the full case
 *    detail and can connect/disconnect edges, build evidence paths and
 *    create/update hypotheses with supporting evidence.
 * Fully async — progress lands in the Autopilot activity tab.
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
  /** Focus the run on one case — hides scope/agents, implies the case agent. */
  caseId?: string;
  caseTitle?: string;
  onTriggered?: (cycleKey: string) => void;
}) {
  const { t } = useTranslation();
  const caseMode = Boolean(caseId);
  const [instruction, setInstruction] = React.useState("");
  const [sourceId, setSourceId] = React.useState(defaultSourceId ?? ALL_SOURCES);
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(PIPELINE_KINDS),
  );
  const [sources, setSources] = React.useState<Array<{ id: string; name: string }>>([]);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open || caseMode) return;
    setSourceId(defaultSourceId ?? ALL_SOURCES);
    setSelected(new Set(PIPELINE_KINDS));
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

  const toggle = (kind: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  const allPipeline = PIPELINE_KINDS.every((k) => selected.has(k));
  const toggleFullPipeline = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPipeline) PIPELINE_KINDS.forEach((k) => next.delete(k));
      else PIPELINE_KINDS.forEach((k) => next.add(k));
      return next;
    });

  const hasPipeline = PIPELINE_AGENTS.some((a) => selected.has(a.kind));
  const onlyDuplicates =
    selected.size === 1 && selected.has(Kind.Duplicates);
  const canSubmit = caseMode || selected.size > 0;

  const run = async () => {
    try {
      setSubmitting(true);
      const agentKinds = caseMode
        ? undefined
        : ORDERED.filter((a) => selected.has(a.kind)).map((a) => a.kind);
      const res = await api.autopilot.autopilotControllerTrigger({
        triggerAutopilotDto: {
          instruction: instruction.trim() || undefined,
          sourceId:
            caseMode || !hasPipeline || sourceId === ALL_SOURCES
              ? undefined
              : sourceId,
          caseId: caseId || undefined,
          agentKinds,
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
      toast.error(
        err instanceof Error
          ? err.message
          : t("investigations.autopilot.runDialog.toastError"),
      );
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
            {caseMode
              ? t("investigations.autopilot.runDialog.titleCase")
              : t("investigations.autopilot.runDialog.titleGeneral")}
          </DialogTitle>
          <DialogDescription>
            {caseMode
              ? t("investigations.autopilot.runDialog.descCase", {
                  title: caseTitle ?? "this case",
                })
              : t("investigations.autopilot.runDialog.descGeneral")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="font-mono text-xs uppercase tracking-[0.12em]">
              {caseMode
                ? t("investigations.autopilot.runDialog.instructionLabelCase")
                : t("investigations.autopilot.runDialog.instructionLabelGeneral")}
            </Label>
            <Textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={4}
              maxLength={4000}
              placeholder={
                caseMode
                  ? t("investigations.autopilot.runDialog.placeholderCase")
                  : t("investigations.autopilot.runDialog.placeholderGeneral")
              }
              className="rounded-[4px] border-2 border-border text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              {caseMode
                ? t("investigations.autopilot.runDialog.instructionOptionalCase")
                : t("investigations.autopilot.runDialog.instructionOptionalGeneral")}
            </p>
          </div>

          {!caseMode && (
            <>
              {/* ── Pipeline agents (chained) ── */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="font-mono text-xs uppercase tracking-[0.12em]">
                    {t("investigations.autopilot.runDialog.pipelineGroup")}
                  </Label>
                  <button
                    type="button"
                    onClick={toggleFullPipeline}
                    className="font-mono text-[10px] uppercase tracking-wide text-[#d97706] hover:underline"
                  >
                    {allPipeline
                      ? t("investigations.autopilot.runDialog.clearAll")
                      : t("investigations.autopilot.runDialog.fullPipeline")}
                  </button>
                </div>
                <div className="space-y-1.5">
                  {PIPELINE_AGENTS.map((a) => (
                    <AgentRow
                      key={a.kind}
                      checked={selected.has(a.kind)}
                      onToggle={() => toggle(a.kind)}
                      label={t(
                        `investigations.autopilot.runDialog.agents.${a.key}.label` as never,
                      )}
                      desc={t(
                        `investigations.autopilot.runDialog.agents.${a.key}.desc` as never,
                      )}
                    />
                  ))}
                </div>
              </div>

              {/* ── Global maintenance agents ── */}
              <div className="space-y-1.5">
                <Label className="font-mono text-xs uppercase tracking-[0.12em]">
                  {t("investigations.autopilot.runDialog.globalGroup")}
                </Label>
                <div className="space-y-1.5">
                  {GLOBAL_AGENTS.map((a) => (
                    <AgentRow
                      key={a.kind}
                      checked={selected.has(a.kind)}
                      onToggle={() => toggle(a.kind)}
                      label={t(
                        `investigations.autopilot.runDialog.agents.${a.key}.label` as never,
                      )}
                      desc={t(
                        `investigations.autopilot.runDialog.agents.${a.key}.desc` as never,
                      )}
                    />
                  ))}
                </div>
                {onlyDuplicates && (
                  <p className="text-[11px] text-muted-foreground">
                    {t("investigations.autopilot.runDialog.duplicatesHint")}
                  </p>
                )}
              </div>

              {/* ── Source scope (pipeline agents only) ── */}
              {hasPipeline && (
                <div className="space-y-1.5">
                  <Label className="font-mono text-xs uppercase tracking-[0.12em]">
                    {t("investigations.autopilot.runDialog.scopeLabel")}
                  </Label>
                  <Select value={sourceId} onValueChange={setSourceId}>
                    <SelectTrigger className="h-9 rounded-[4px] border-2 border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_SOURCES}>
                        {t("investigations.autopilot.runDialog.scopeAllSources")}
                      </SelectItem>
                      {sources.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("investigations.autopilot.runDialog.cancel")}
            </Button>
            <Button onClick={() => void run()} disabled={submitting || !canSubmit}>
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {caseMode
                ? t("investigations.autopilot.runDialog.submitCase")
                : t("investigations.autopilot.runDialog.submitGeneral")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A selectable agent row: checkbox + label + one-line description. */
function AgentRow({
  checked,
  onToggle,
  label,
  desc,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex w-full items-start gap-3 rounded-[4px] border-2 px-3 py-2 text-left transition-colors",
        checked
          ? "border-[#d97706]/50 bg-[#d97706]/5"
          : "border-border hover:border-foreground/30",
      )}
    >
      <Checkbox checked={checked} className="pointer-events-none mt-0.5" />
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-[11px] leading-snug text-muted-foreground">
          {desc}
        </div>
      </div>
    </button>
  );
}
