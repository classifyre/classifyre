"use client";

import * as React from "react";
import { Input, Label, Switch } from "@workspace/ui/components";
import { Plug } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@workspace/ui/lib/utils";
import { useInstanceSettings } from "@/components/instance-settings-provider";
import { useTranslation } from "@/hooks/use-translation";
import { HarnessMcp } from "./harness-mcp";
import { AiProvidersCard } from "@/components/ai-providers-card";

/**
 * Harness configuration — global switches that aren't per-agent. Per-agent
 * enable/goal/tool assignment lives in the Agents tab; this surface keeps the
 * external-MCP master toggle and the MCP server management it gates.
 */
export function HarnessConfig() {
  const { t } = useTranslation();
  const { settings, saving, updateSettings } = useInstanceSettings();
  const [busy, setBusy] = React.useState(false);

  const aiReady = !!settings.harnessAiProviderConfigId;
  const disabled = busy || saving;

  const save = React.useCallback(
    async (payload: Parameters<typeof updateSettings>[0], message: string) => {
      try {
        setBusy(true);
        await updateSettings(payload);
        toast.success(message);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("settings.failedToSave"));
      } finally {
        setBusy(false);
      }
    },
    [updateSettings, t],
  );

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="font-serif text-xl font-black uppercase tracking-[0.04em]">
          {t("harness.config.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("harness.config.desc")}
        </p>
      </div>

      <AiProvidersCard />

      {!aiReady && (
        <p className="rounded-[4px] border border-dashed border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
          {t("harness.config.requiresAi")}
        </p>
      )}

      <div
        className={cn(
          "space-y-3 rounded-[4px] border-2 px-4 py-3 transition-colors",
          settings.autopilotMcpEnabled
            ? "border-[#d97706]/40 bg-[#d97706]/[0.04]"
            : "border-border bg-muted/20",
        )}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Plug className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-sm font-medium">
                {t("harness.config.agents.mcp.name")}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("harness.config.agents.mcp.desc")}
            </p>
          </div>
          <Switch
            checked={settings.autopilotMcpEnabled}
            disabled={disabled || !aiReady}
            onCheckedChange={(v) =>
              void save(
                { autopilotMcpEnabled: v },
                t("harness.config.enabledToast"),
              )
            }
            aria-label={t("harness.config.agents.mcp.name")}
          />
        </div>
      </div>

      {settings.autopilotMcpEnabled && <HarnessMcp />}

      <LimitsCard disabled={disabled} save={save} />
    </div>
  );
}

/**
 * Instance-wide harness limits.
 *
 * These were hardcoded constants. They are here rather than on the Agents tab
 * because they apply to every agent at once — a per-agent copy of "how big may
 * one tool result be" would be twelve places to get the same answer wrong.
 * The one exception, the run budget, is overridable per agent for the one that
 * is legitimately slower than the rest.
 */
function LimitsCard({
  disabled,
  save,
}: {
  disabled: boolean;
  save: (
    payload: Record<string, number>,
    message: string,
  ) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const { settings } = useInstanceSettings();

  const groups = [
    {
      title: "harness.config.limits.budgets",
      hint: "harness.config.limits.budgetsDesc",
      fields: [
        { key: "harnessRunBudgetMinutes", label: "harness.config.limits.runBudget", hint: "harness.config.limits.runBudgetHint", min: 1, max: 480, step: 1 },
        { key: "harnessRunStaleAfterMinutes", label: "harness.config.limits.staleAfter", hint: "harness.config.limits.staleAfterHint", min: 1, max: 1440, step: 1 },
        { key: "harnessCycleBudgetMinutes", label: "harness.config.limits.cycleBudget", hint: "harness.config.limits.cycleBudgetHint", min: 1, max: 720, step: 1 },
      ],
    },
    {
      title: "harness.config.limits.evidence",
      hint: "harness.config.limits.evidenceDesc",
      fields: [
        { key: "harnessEvidenceUsableFindings", label: "harness.config.limits.usableFindings", hint: "harness.config.limits.usableFindingsHint", min: 0, max: 10_000_000, step: 100 },
        { key: "harnessEvidenceUsableCoverage", label: "harness.config.limits.usableCoverage", hint: "harness.config.limits.usableCoverageHint", min: 0, max: 1, step: 0.05 },
        { key: "harnessEvidenceWarnCoverage", label: "harness.config.limits.warnCoverage", hint: "harness.config.limits.warnCoverageHint", min: 0, max: 1, step: 0.05 },
        { key: "harnessExpressImportance", label: "harness.config.limits.expressImportance", hint: "harness.config.limits.expressImportanceHint", min: 0, max: 1, step: 0.05 },
      ],
    },
    {
      title: "harness.config.limits.context",
      hint: "harness.config.limits.contextDesc",
      fields: [
        { key: "harnessObservationChars", label: "harness.config.limits.observationChars", hint: "harness.config.limits.observationCharsHint", min: 1000, max: 100_000, step: 500 },
        { key: "harnessTurnObservationChars", label: "harness.config.limits.turnChars", hint: "harness.config.limits.turnCharsHint", min: 1000, max: 500_000, step: 1000 },
        { key: "harnessMaxRankedFindings", label: "harness.config.limits.rankedFindings", hint: "harness.config.limits.rankedFindingsHint", min: 1, max: 200, step: 1 },
        { key: "harnessMaxGlossaryEntries", label: "harness.config.limits.glossaryEntries", hint: "harness.config.limits.glossaryEntriesHint", min: 0, max: 200, step: 1 },
        { key: "harnessMaxRecalledMemories", label: "harness.config.limits.recalledMemories", hint: "harness.config.limits.recalledMemoriesHint", min: 0, max: 200, step: 1 },
        { key: "harnessDreamIntervalDays", label: "harness.config.limits.dreamInterval", hint: "harness.config.limits.dreamIntervalHint", min: 1, max: 90, step: 1 },
      ],
    },
  ] as const;

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div
          key={group.title}
          className="space-y-3 rounded-[4px] border-2 border-border bg-muted/10 px-4 py-3"
        >
          <div className="space-y-0.5">
            <p className="text-sm font-medium">{t(group.title)}</p>
            <p className="text-xs text-muted-foreground">{t(group.hint)}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.fields.map((field) => (
              <LimitField
                key={field.key}
                settingKey={field.key}
                labelKey={field.label}
                hintKey={field.hint}
                value={
                  (settings as unknown as Record<string, number>)[field.key]
                }
                min={field.min}
                max={field.max}
                step={field.step}
                disabled={disabled}
                save={save}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** One numeric limit, saved on blur rather than per keystroke. */
function LimitField({
  settingKey,
  labelKey,
  hintKey,
  value,
  min,
  max,
  step,
  disabled,
  save,
}: {
  settingKey: string;
  labelKey: Parameters<ReturnType<typeof useTranslation>["t"]>[0];
  hintKey: Parameters<ReturnType<typeof useTranslation>["t"]>[0];
  value: number | undefined;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  save: (
    payload: Record<string, number>,
    message: string,
  ) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = React.useState(String(value ?? ""));

  React.useEffect(() => {
    setDraft(String(value ?? ""));
  }, [value]);

  const commit = () => {
    const next = Number(draft);
    if (!Number.isFinite(next) || next < min || next > max) {
      // Snap back rather than sending a value the API will reject: the bounds
      // are already stated next to the field.
      setDraft(String(value ?? ""));
      return;
    }
    if (next === value) return;
    void save({ [settingKey]: next }, t("harness.config.limits.saved"));
  };

  return (
    <div className="space-y-1">
      <Label className="text-[11px]">
        {t(labelKey)}
      </Label>
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        className="h-8 rounded-[4px] border-2 border-border font-mono text-xs tabular-nums"
      />
      <p className="text-[10px] leading-snug text-muted-foreground">
        {t(hintKey)}
      </p>
    </div>
  );
}
