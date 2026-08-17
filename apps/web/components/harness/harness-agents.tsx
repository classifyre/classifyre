"use client";

import * as React from "react";
import {
  api,
  AgentConfigDtoTriggerModeEnum as TriggerMode,
  type AgentConfigDto,
  type HarnessToolDto,
} from "@workspace/api-client";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@workspace/ui/components";
import {
  Clock,
  Eye,
  FileText,
  Loader2,
  Pencil,
  Plug,
  Plus,
  RotateCcw,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@workspace/ui/lib/utils";
import { useInstanceSettings } from "@/components/instance-settings-provider";
import { useTranslation } from "@/hooks/use-translation";
import { KindGlyph, kindLabelKey } from "./harness-kind";
import { HarnessChain } from "./harness-chain";

/** Trigger modes in the order an operator should consider them: most eager first. */
const MODES = [
  TriggerMode.Eager,
  TriggerMode.Batch,
  TriggerMode.Settled,
  TriggerMode.Scheduled,
  TriggerMode.Manual,
] as const;

/** Explicit key map: `t()` is compile-time checked, so template keys defeat it. */
const MODE_KEYS = {
  [TriggerMode.Eager]: {
    name: "harness.agents.modes.eager",
    desc: "harness.agents.modes.eagerDesc",
  },
  [TriggerMode.Batch]: {
    name: "harness.agents.modes.batch",
    desc: "harness.agents.modes.batchDesc",
  },
  [TriggerMode.Settled]: {
    name: "harness.agents.modes.settled",
    desc: "harness.agents.modes.settledDesc",
  },
  [TriggerMode.Scheduled]: {
    name: "harness.agents.modes.scheduled",
    desc: "harness.agents.modes.scheduledDesc",
  },
  [TriggerMode.Manual]: {
    name: "harness.agents.modes.manual",
    desc: "harness.agents.modes.manualDesc",
  },
} as const;

/**
 * The three preconditions an agent can insist on.
 *
 * Independent switches rather than one "readiness" toggle because that is the
 * whole point: detector tuning needs a settled corpus but does not care about
 * the inquiry-matching queue, while the inquiry agent is the exact opposite.
 */
const GATES = [
  {
    key: "waitForScans",
    label: "harness.agents.gate.scans",
    hint: "harness.agents.gate.scansHint",
  },
  {
    key: "waitForMatching",
    label: "harness.agents.gate.matching",
    hint: "harness.agents.gate.matchingHint",
  },
  {
    key: "waitForEvidence",
    label: "harness.agents.gate.evidence",
    hint: "harness.agents.gate.evidenceHint",
  },
] as const;

/**
 * Per-agent control surface: enable each agent, decide when it is allowed to
 * run, and assign/remove any built-in tool (including tools that belong to
 * other agents by default). The mission text lives in a dialog rather than
 * inline. MCP tools are shown read-only — they are scoped per server under the
 * MCP section, not assigned here.
 */
export function HarnessAgents() {
  const { t } = useTranslation();
  const { settings } = useInstanceSettings();
  const [agents, setAgents] = React.useState<AgentConfigDto[]>([]);
  const [tools, setTools] = React.useState<HarnessToolDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [picker, setPicker] = React.useState<AgentConfigDto | null>(null);

  const aiReady = !!settings.harnessAiProviderConfigId;

  const load = React.useCallback(async () => {
    try {
      const [a, tl] = await Promise.all([
        api.autopilot.autopilotControllerGetAgents(),
        api.autopilot.autopilotControllerGetTools(),
      ]);
      setAgents(a.agents);
      setTools(tl.tools);
    } catch {
      // transient
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const builtinTools = React.useMemo(
    () => tools.filter((tool) => tool.source === "builtin"),
    [tools],
  );

  const patch = React.useCallback(
    async (
      kind: AgentConfigDto["kind"],
      dto: Parameters<
        typeof api.autopilot.autopilotControllerUpdateAgent
      >[0]["updateAgentConfigDto"],
      message?: string,
    ) => {
      const updated = await api.autopilot.autopilotControllerUpdateAgent({
        kind,
        updateAgentConfigDto: dto,
      });
      setAgents((prev) => prev.map((a) => (a.kind === updated.kind ? updated : a)));
      toast.success(message ?? t("harness.agents.saved"));
    },
    [t],
  );

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("harness.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!aiReady && (
        <p className="rounded-[4px] border border-dashed border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
          {t("harness.agents.requiresAi")}
        </p>
      )}

      <HarnessChain agents={agents} />

      {agents.map((agent) => (
        <AgentCard
          key={agent.kind}
          agent={agent}
          disabled={!aiReady}
          tools={builtinTools}
          onPatch={patch}
          onOpenPicker={() => setPicker(agent)}
        />
      ))}

      <ToolPicker
        agent={picker}
        tools={builtinTools}
        onClose={() => setPicker(null)}
        onApply={async (kind, toolNames) => {
          await patch(kind, { toolNames });
          setPicker(null);
        }}
      />
    </div>
  );
}

function AgentCard({
  agent,
  disabled,
  tools,
  onPatch,
  onOpenPicker,
}: {
  agent: AgentConfigDto;
  disabled: boolean;
  tools: HarnessToolDto[];
  onPatch: (
    kind: AgentConfigDto["kind"],
    dto: Parameters<
      typeof api.autopilot.autopilotControllerUpdateAgent
    >[0]["updateAgentConfigDto"],
    message?: string,
  ) => Promise<void>;
  onOpenPicker: () => void;
}) {
  const { t } = useTranslation();
  const [maxIterations, setMaxIterations] = React.useState(
    String(agent.maxIterations),
  );
  const [runBudget, setRunBudget] = React.useState(
    agent.runBudgetMinutes == null ? "" : String(agent.runBudgetMinutes),
  );
  const [minInterval, setMinInterval] = React.useState(
    String(agent.minIntervalMinutes),
  );
  const [maxStaleness, setMaxStaleness] = React.useState(
    String(agent.maxStalenessHours),
  );
  const [promptOpen, setPromptOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setMaxIterations(String(agent.maxIterations));
    setRunBudget(
      agent.runBudgetMinutes == null ? "" : String(agent.runBudgetMinutes),
    );
    setMinInterval(String(agent.minIntervalMinutes));
    setMaxStaleness(String(agent.maxStalenessHours));
  }, [
    agent.maxIterations,
    agent.runBudgetMinutes,
    agent.minIntervalMinutes,
    agent.maxStalenessHours,
  ]);

  const byName = React.useMemo(
    () => new Map(tools.map((tool) => [tool.name, tool])),
    [tools],
  );

  const dirty =
    maxIterations !== String(agent.maxIterations) ||
    minInterval !== String(agent.minIntervalMinutes) ||
    maxStaleness !== String(agent.maxStalenessHours) ||
    runBudget !== (agent.runBudgetMinutes == null ? "" : String(agent.runBudgetMinutes));

  const run = async (
    fn: () => Promise<void>,
    onErr = t("settings.failedToSave"),
  ) => {
    try {
      setBusy(true);
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : onErr);
    } finally {
      setBusy(false);
    }
  };

  /** Empty means "follow the instance default", which the API reads as null. */
  const optionalNumber = (raw: string) =>
    raw.trim() === "" ? null : Number(raw);

  const saveNumbers = () =>
    void run(() =>
      onPatch(agent.kind, {
        maxIterations: Number(maxIterations) || agent.defaultMaxIterations,
        minIntervalMinutes: Number(minInterval) || 0,
        maxStalenessHours: Number(maxStaleness) || 0,
        runBudgetMinutes: optionalNumber(runBudget),
      }),
    );

  const removeTool = (name: string) =>
    void run(() =>
      onPatch(agent.kind, {
        toolNames: agent.toolNames.filter((n) => n !== name),
      }),
    );

  const setMode = (mode: AgentConfigDto["triggerMode"]) =>
    void run(() => onPatch(agent.kind, { triggerMode: mode }));

  const setGate = (
    gate: "waitForMatching" | "waitForEvidence" | "waitForScans",
    value: boolean,
  ) => void run(() => onPatch(agent.kind, { [gate]: value }));

  // MANUAL never starts on its own and SCHEDULED runs on its own clock, so the
  // gates are inert for both — shown disabled rather than hidden, because
  // hiding them makes the card look like it lost settings when the mode changes.
  const gatesApply =
    agent.triggerMode !== TriggerMode.Manual &&
    agent.triggerMode !== TriggerMode.Scheduled;

  return (
    <div
      className={cn(
        "space-y-3 rounded-[4px] border-2 px-4 py-3 transition-colors",
        agent.enabled
          ? "border-[#d97706]/40 bg-[#d97706]/[0.04]"
          : "border-border bg-muted/20",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <KindGlyph
            kind={agent.kind}
            className="h-4 w-4 text-muted-foreground"
          />
          <p className="text-sm font-medium">{t(kindLabelKey(agent.kind))}</p>
          {agent.customized && (
            <Badge
              variant="outline"
              className="border-[#d97706]/50 text-[#d97706] text-[9px] uppercase"
            >
              {t("harness.agents.customized")}
            </Badge>
          )}
        </div>
        {agent.enableable ? (
          <Switch
            checked={agent.enabled}
            disabled={disabled || busy}
            onCheckedChange={(v) =>
              void run(() => onPatch(agent.kind, { enabled: v }))
            }
            aria-label={t("harness.agents.enabled")}
          />
        ) : (
          <Badge variant="outline" className="font-mono text-[9px] uppercase">
            {t("harness.agents.alwaysOn")}
          </Badge>
        )}
      </div>

      {/* Runs when — the decision an operator is actually making here */}
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em]">
          <Clock className="h-3 w-3" />
          {t("harness.agents.runsWhen")}
        </Label>

        <Select
          value={agent.triggerMode}
          disabled={disabled || busy}
          onValueChange={(v) => setMode(v as AgentConfigDto["triggerMode"])}
        >
          <SelectTrigger className="h-8 w-full rounded-[4px] border-2 border-border text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {t(MODE_KEYS[mode].name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          {t(MODE_KEYS[agent.triggerMode].desc)}
        </p>

        {/* Gates: what this agent refuses to reason without */}
        <div className="grid gap-1.5 sm:grid-cols-3">
          {GATES.map(({ key, label, hint }) => (
            <label
              key={key}
              className={cn(
                "flex items-start gap-2 rounded-[3px] border border-border px-2 py-1.5",
                !gatesApply && "opacity-50",
              )}
            >
              <Switch
                checked={agent[key]}
                disabled={disabled || busy || !gatesApply}
                onCheckedChange={(v) => setGate(key, v)}
                aria-label={t(label)}
                className="mt-0.5 scale-75"
              />
              <span className="min-w-0">
                <span className="block text-[11px] font-medium">
                  {t(label)}
                </span>
                <span className="block text-[10px] leading-snug text-muted-foreground">
                  {t(hint)}
                </span>
              </span>
            </label>
          ))}
        </div>

        {/* Guardrails: time bounds the trigger, it never IS the trigger */}
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-[11px]">
              {t("harness.agents.minInterval")}
            </Label>
            <Input
              type="number"
              min={0}
              value={minInterval}
              disabled={disabled || busy}
              onChange={(e) => setMinInterval(e.target.value)}
              className="h-8 rounded-[4px] border-2 border-border text-sm"
            />
            <p className="text-[10px] leading-snug text-muted-foreground">
              {t("harness.agents.minIntervalHint")}
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">
              {t("harness.agents.maxStaleness")}
            </Label>
            <Input
              type="number"
              min={0}
              value={maxStaleness}
              disabled={disabled || busy}
              onChange={(e) => setMaxStaleness(e.target.value)}
              className="h-8 rounded-[4px] border-2 border-border text-sm"
            />
            <p className="text-[10px] leading-snug text-muted-foreground">
              {t("harness.agents.maxStalenessHint")}
            </p>
          </div>
        </div>
      </div>

      {/* System prompt: hidden behind a dialog — it is thousands of words and
          made every other control on this card unreachable without scrolling. */}
      <div className="flex items-center justify-between gap-2">
        <Label className="font-mono text-[11px] uppercase tracking-[0.12em]">
          {t("harness.agents.goal")}
        </Label>
        <div className="flex items-center gap-2">
          {agent.goal !== agent.defaultGoal && (
            <Badge
              variant="outline"
              className="border-[#d97706]/50 text-[#d97706] text-[9px] uppercase"
            >
              {t("harness.agents.edited")}
            </Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setPromptOpen(true)}
          >
            <FileText className="h-3.5 w-3.5" />
            {t("harness.agents.viewPrompt")}
          </Button>
        </div>
      </div>

      <SystemPromptDialog
        agent={agent}
        open={promptOpen}
        onOpenChange={setPromptOpen}
        onPatch={onPatch}
      />

      {/* Tools */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em]">
            <Wrench className="h-3 w-3" />
            {t("harness.agents.tools")}
            <span className="text-muted-foreground/70">
              ({t("harness.agents.toolCount", { count: agent.toolNames.length })})
            </span>
          </Label>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={onOpenPicker}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("harness.agents.addTools")}
          </Button>
        </div>
        {agent.toolNames.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("harness.agents.noTools")}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {agent.toolNames.map((name) => {
              const tool = byName.get(name);
              const mutate = tool?.sideEffect === "mutate";
              return (
                <span
                  key={name}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-px font-mono text-[10px]",
                    mutate
                      ? "border-[#d97706]/50 text-[#d97706]"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {mutate ? (
                    <Pencil className="h-2.5 w-2.5" />
                  ) : (
                    <Eye className="h-2.5 w-2.5" />
                  )}
                  {name}
                  <button
                    type="button"
                    aria-label={t("harness.agents.removeTool")}
                    onClick={() => removeTool(name)}
                    disabled={busy}
                    className="ml-0.5 hover:text-red-600"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* MCP tools (read-only) */}
      <div className="space-y-1">
        <Label className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em]">
          <Plug className="h-3 w-3" />
          {t("harness.agents.mcpTools")}
        </Label>
        {agent.mcpToolNames.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            {t("harness.agents.mcpNone")} {t("harness.agents.mcpHint")}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {agent.mcpToolNames.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded-[3px] border border-stone-400/40 px-1.5 py-px font-mono text-[10px] text-stone-500"
              >
                <Plug className="h-2.5 w-2.5" />
                {name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Advanced: the limits most operators never need to touch */}
      <Accordion type="multiple">
        <AccordionItem value="advanced" className="border-0">
          <AccordionTrigger
            data-testid={`accordion-trigger-advanced-${agent.kind}`}
            className="py-1 font-mono text-[11px] uppercase tracking-[0.12em] hover:no-underline"
          >
            {t("harness.agents.advanced")}
          </AccordionTrigger>
          <AccordionContent className="grid gap-2 pt-1 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[11px]">
                {t("harness.agents.maxIterations")}
              </Label>
              <Input
                type="number"
                min={1}
                max={50}
                value={maxIterations}
                onChange={(e) => setMaxIterations(e.target.value)}
                className="h-8 rounded-[4px] border-2 border-border text-sm"
              />
              <p className="text-[10px] leading-snug text-muted-foreground">
                {t("harness.agents.maxIterationsHint")}
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">
                {t("harness.agents.runBudget")}
              </Label>
              <Input
                type="number"
                min={1}
                max={480}
                value={runBudget}
                placeholder={t("harness.agents.runBudgetDefault")}
                onChange={(e) => setRunBudget(e.target.value)}
                className="h-8 rounded-[4px] border-2 border-border text-sm"
              />
              <p className="text-[10px] leading-snug text-muted-foreground">
                {t("harness.agents.runBudgetHint")}
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <div className="flex items-center justify-end pt-1">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !dirty}
          onClick={saveNumbers}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {t("harness.agents.save")}
        </Button>
      </div>
    </div>
  );
}

/**
 * The mission text, full width and out of the way.
 *
 * It used to sit inline as a four-row textarea holding thousands of words of
 * doctrine, which made it both unreadable and the dominant element of every
 * card. Here it gets the room it needs and the card gets its own back.
 */
function SystemPromptDialog({
  agent,
  open,
  onOpenChange,
  onPatch,
}: {
  agent: AgentConfigDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPatch: (
    kind: AgentConfigDto["kind"],
    dto: Parameters<
      typeof api.autopilot.autopilotControllerUpdateAgent
    >[0]["updateAgentConfigDto"],
    message?: string,
  ) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = React.useState(agent.goal);
  const [busy, setBusy] = React.useState(false);

  // Re-sync whenever it reopens or the server value changes, so a cancelled
  // edit does not survive as a phantom draft.
  React.useEffect(() => {
    if (open) setDraft(agent.goal);
  }, [open, agent.goal]);

  const customized = agent.goal !== agent.defaultGoal;

  const run = async (fn: () => Promise<void>) => {
    try {
      setBusy(true);
      await fn();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.failedToSave"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-5xl flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KindGlyph kind={agent.kind} className="h-4 w-4" />
            {t(kindLabelKey(agent.kind))} — {t("harness.agents.goal")}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {t("harness.agents.promptHint")}
        </p>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={20000}
          className="flex-1 resize-none rounded-[4px] border-2 border-border font-mono text-xs leading-relaxed"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] text-muted-foreground">
            {t("harness.agents.promptChars", { count: draft.length })}
          </span>
          <div className="flex items-center gap-2">
            {customized && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void run(() => onPatch(agent.kind, { goal: null }))}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t("harness.agents.resetGoal")}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={busy || draft === agent.goal}
              onClick={() => void run(() => onPatch(agent.kind, { goal: draft }))}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {t("harness.agents.save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Modal catalog of every built-in tool, grouped by namespace, with checkboxes. */
function ToolPicker({
  agent,
  tools,
  onClose,
  onApply,
}: {
  agent: AgentConfigDto | null;
  tools: HarnessToolDto[];
  onClose: () => void;
  onApply: (
    kind: AgentConfigDto["kind"],
    toolNames: string[],
  ) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setSelected(new Set(agent?.toolNames ?? []));
  }, [agent]);

  const grouped = React.useMemo(() => {
    const map = new Map<string, HarnessToolDto[]>();
    for (const tool of tools) {
      const prefix = tool.name.split(".")[0] ?? "misc";
      const list = map.get(prefix) ?? [];
      list.push(tool);
      map.set(prefix, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [tools]);

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const apply = async () => {
    if (!agent) return;
    try {
      setSaving(true);
      await onApply(agent.kind, [...selected]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.failedToSave"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={agent !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-hidden rounded-[6px] border-2 border-border sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-[#d97706]" />
            {t("harness.agents.pickTitle")}
            {agent && (
              <span className="font-mono text-xs text-muted-foreground">
                · {t(kindLabelKey(agent.kind))}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {t("harness.agents.pickDesc")}
        </p>
        <ScrollArea className="max-h-[55vh] pr-3">
          <div className="space-y-3">
            {grouped.map(([prefix, list]) => (
              <div key={prefix}>
                <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-foreground">
                  {prefix}
                </p>
                <ul className="space-y-1">
                  {list.map((tool) => (
                    <li key={tool.name}>
                      <label className="flex cursor-pointer items-start gap-2 rounded-[3px] px-1 py-1 hover:bg-muted/40">
                        <Checkbox
                          checked={selected.has(tool.name)}
                          onCheckedChange={() => toggle(tool.name)}
                          className="mt-0.5"
                        />
                        <span className="min-w-0">
                          <span className="font-mono text-xs">{tool.name}</span>
                          <span className="block text-[11px] leading-snug text-muted-foreground">
                            {tool.description}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </ScrollArea>
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="font-mono text-[11px] text-muted-foreground">
            {t("harness.agents.selected", { count: selected.size })}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {t("harness.agents.cancel")}
            </Button>
            <Button onClick={apply} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {t("harness.agents.apply")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
