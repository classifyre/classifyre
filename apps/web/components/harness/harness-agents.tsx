"use client";

import * as React from "react";
import {
  api,
  type AgentConfigDto,
  type HarnessToolDto,
} from "@workspace/api-client";
import {
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
  Switch,
  Textarea,
} from "@workspace/ui/components";
import {
  Eye,
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

/**
 * Per-agent control surface: enable each agent, edit its goal and iteration
 * budget, and assign/remove any built-in tool (including tools that belong to
 * other agents by default). MCP tools are shown read-only — they are scoped per
 * server under the MCP section, not assigned here.
 */
export function HarnessAgents() {
  const { t } = useTranslation();
  const { settings } = useInstanceSettings();
  const [agents, setAgents] = React.useState<AgentConfigDto[]>([]);
  const [tools, setTools] = React.useState<HarnessToolDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [picker, setPicker] = React.useState<AgentConfigDto | null>(null);

  const aiReady = settings.aiEnabled && !!settings.aiProviderConfigId;

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
  const [goal, setGoal] = React.useState(agent.goal);
  const [maxIterations, setMaxIterations] = React.useState(
    String(agent.maxIterations),
  );
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setGoal(agent.goal);
    setMaxIterations(String(agent.maxIterations));
  }, [agent.goal, agent.maxIterations]);

  const byName = React.useMemo(
    () => new Map(tools.map((tool) => [tool.name, tool])),
    [tools],
  );

  const dirty =
    goal !== agent.goal || maxIterations !== String(agent.maxIterations);
  const goalCustom = agent.goal !== agent.defaultGoal;

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

  const saveText = () =>
    void run(() =>
      onPatch(agent.kind, {
        goal,
        maxIterations: Number(maxIterations) || agent.defaultMaxIterations,
      }),
    );

  const removeTool = (name: string) =>
    void run(() =>
      onPatch(agent.kind, {
        toolNames: agent.toolNames.filter((n) => n !== name),
      }),
    );

  const resetGoal = () =>
    void run(() => onPatch(agent.kind, { goal: null }));

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

      {/* Goal */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="font-mono text-[11px] uppercase tracking-[0.12em]">
            {t("harness.agents.goal")}
          </Label>
          {goalCustom && (
            <button
              type="button"
              onClick={resetGoal}
              disabled={busy}
              className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-2.5 w-2.5" />
              {t("harness.agents.resetGoal")}
            </button>
          )}
        </div>
        <Textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={4}
          maxLength={20000}
          className="rounded-[4px] border-2 border-border text-sm"
        />
      </div>

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

      {/* Footer: max steps + save */}
      <div className="flex items-end justify-between gap-3 pt-1">
        <div className="space-y-1">
          <Label className="font-mono text-[11px] uppercase tracking-[0.12em]">
            {t("harness.agents.maxIterations")}
          </Label>
          <Input
            type="number"
            min={1}
            max={50}
            value={maxIterations}
            onChange={(e) => setMaxIterations(e.target.value)}
            className="h-8 w-20 rounded-[4px] border-2 border-border text-sm"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !dirty}
          onClick={saveText}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {t("harness.agents.save")}
        </Button>
      </div>
    </div>
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
