"use client";

import * as React from "react";
import { CalendarClock, RefreshCw } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Switch } from "@workspace/ui/components/switch";
import { Label } from "@workspace/ui/components/label";
import { Badge } from "@workspace/ui/components/badge";
import { Separator } from "@workspace/ui/components/separator";
import { cn } from "@workspace/ui/lib/utils";

import { describeCronLocal } from "@/lib/date";
import { useTranslation } from "@/hooks/use-translation";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type SchedulePreset =
  | "none"
  | "nightly"
  | "daily"
  | "weekday_morning"
  | "weekday_business"
  | "weekly"
  | "custom";

export type ScheduleValue = {
  enabled: boolean;
  preset: SchedulePreset;
  cron: string;
  timezone: string;
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function rand(n: number): number {
  return Math.floor(Math.random() * n);
}

function generateCronForPreset(
  preset: Exclude<SchedulePreset, "none" | "custom">,
): string {
  switch (preset) {
    case "nightly":
      return `${rand(60)} ${rand(2)} * * *`;
    case "daily":
      return `${rand(60)} ${rand(24)} * * *`;
    case "weekday_morning":
      return `${rand(60)} ${6 + rand(3)} * * 1-5`;
    case "weekday_business":
      return `${rand(60)} ${9 + rand(8)} * * 1-5`;
    case "weekly":
      return `${rand(60)} ${rand(2)} * * 0`;
  }
}

function isValidCron(cron: string): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const fieldPattern =
    /^(\*|[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*)(\/([\d]+))?$|^\*\/[\d]+$/;
  return parts.every((part) => fieldPattern.test(part) || part === "*");
}

// ─── Props ─────────────────────────────────────────────────────────────────────

interface ScheduleCardProps {
  value: ScheduleValue;
  onChange: (value: ScheduleValue) => void;
  onSave?: (value: ScheduleValue) => Promise<void>;
  disabled?: boolean;
  className?: string;
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function ScheduleCard({
  value,
  onChange,
  onSave,
  disabled,
  className,
}: ScheduleCardProps) {
  const { t } = useTranslation();

  const PRESETS: {
    value: Exclude<SchedulePreset, "none" | "custom">;
    label: string;
    hint: string;
  }[] = [
    { value: "nightly", label: t("schedule.presets.nightly"), hint: t("schedule.hints.nightly") },
    { value: "daily", label: t("schedule.presets.daily"), hint: t("schedule.hints.daily") },
    { value: "weekday_morning", label: t("schedule.presets.weekdayAm"), hint: t("schedule.hints.weekdayAm") },
    {
      value: "weekday_business",
      label: t("schedule.presets.businessHours"),
      hint: t("schedule.hints.businessHours"),
    },
    { value: "weekly", label: t("schedule.presets.weekly"), hint: t("schedule.hints.weekly") },
  ];

  const [isSaving, setIsSaving] = React.useState(false);
  const [cronInput, setCronInput] = React.useState(value.cron);
  const [cronError, setCronError] = React.useState("");

  // Sync cronInput when value changes externally (preset select, re-roll, etc.)
  React.useEffect(() => {
    setCronInput(value.cron);
    setCronError("");
  }, [value.cron]);

  // ── Preset handlers ───────────────────────────────────────────────────────────

  const handleEnabledChange = (enabled: boolean) => {
    if (!enabled) {
      onChange({ ...value, enabled: false, preset: "none", cron: "" });
    } else {
      const preset: Exclude<SchedulePreset, "none" | "custom"> =
        value.preset === "none" || value.preset === "custom"
          ? "nightly"
          : (value.preset as Exclude<SchedulePreset, "none" | "custom">);
      onChange({
        ...value,
        enabled: true,
        preset,
        cron: generateCronForPreset(preset),
      });
    }
  };

  const handlePresetSelect = (
    preset: Exclude<SchedulePreset, "none" | "custom">,
  ) => {
    onChange({
      ...value,
      enabled: true,
      preset,
      cron: generateCronForPreset(preset),
    });
  };

  const handleReroll = () => {
    if (!value.enabled || value.preset === "none" || value.preset === "custom")
      return;
    onChange({
      ...value,
      cron: generateCronForPreset(
        value.preset as Exclude<SchedulePreset, "none" | "custom">,
      ),
    });
  };

  // ── Cron input handlers ───────────────────────────────────────────────────────

  const handleCronInputChange = (raw: string) => {
    setCronInput(raw);
    if (raw && !isValidCron(raw)) {
      setCronError("Invalid — use 5 fields: minute hour day month weekday");
    } else {
      setCronError("");
    }
  };

  const handleApply = () => {
    if (!cronInput || !isValidCron(cronInput)) {
      setCronError("Fix the cron expression before applying");
      return;
    }
    onChange({ ...value, preset: "custom", enabled: true, cron: cronInput });
    setCronError("");
  };

  const handleSave = async () => {
    if (!onSave) return;
    if (value.enabled && cronInput && !isValidCron(cronInput)) {
      setCronError("Fix the cron expression before saving");
      return;
    }
    try {
      setIsSaving(true);
      await onSave(value);
    } finally {
      setIsSaving(false);
    }
  };

  const isPresetActive = (preset: string) =>
    value.enabled && value.preset === preset;

  const cronDescription = isValidCron(value.cron)
    ? describeCronLocal(value.cron)
    : "";

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div
      className={cn(
        "border-2 border-border rounded-[6px] shadow-[6px_6px_0_var(--color-border)] bg-card overflow-hidden",
        disabled && "opacity-60 pointer-events-none",
        className,
      )}
    >
      {/* ── Header bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b-2 border-border bg-foreground text-primary-foreground">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-accent" />
          <span className="text-xs font-mono uppercase tracking-[0.12em] font-bold">
            Ingestion Schedule
          </span>
          {value.enabled && value.cron && (
            <Badge
              variant="outline"
              className="h-5 px-1.5 text-[10px] font-mono border-accent/50 text-accent bg-accent/10 uppercase tracking-wider"
            >
              Active
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Label
            htmlFor="schedule-enabled"
            className="text-[11px] text-primary-foreground/60 cursor-pointer select-none uppercase tracking-[0.08em]"
          >
            {value.enabled ? "On" : "Off"}
          </Label>
          <Switch
            id="schedule-enabled"
            checked={value.enabled}
            onCheckedChange={handleEnabledChange}
            disabled={disabled}
            className="data-[state=checked]:bg-accent data-[state=checked]:[--switch-thumb-color:var(--accent-foreground)]"
          />
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* ── Preset frequency grid ─────────────────────────────────────────── */}
        <div className="space-y-2">
          <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
            Frequency
          </p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {PRESETS.map((preset) => {
              const active = isPresetActive(preset.value);
              return (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => handlePresetSelect(preset.value)}
                  disabled={disabled}
                  className={cn(
                    "group relative flex flex-col items-start gap-0.5 rounded-[4px] border-2 px-3 py-2 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
                    active
                      ? "border-border bg-accent text-accent-foreground shadow-[2px_2px_0_var(--color-border)]"
                      : "border-border/20 hover:border-border hover:bg-foreground/5",
                  )}
                >
                  <span
                    className={cn(
                      "text-xs font-semibold leading-tight",
                      active ? "text-accent-foreground" : "text-foreground",
                    )}
                  >
                    {preset.label}
                  </span>
                  <span
                    className={cn(
                      "text-[10px] font-mono",
                      active
                        ? "text-accent-foreground/60"
                        : "text-muted-foreground",
                    )}
                  >
                    {preset.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <Separator className="bg-border/10" />

        {/* ── Cron input row ────────────────────────────────────────────────── */}
        <div className="space-y-1.5">
          <div className="flex gap-2 items-center">
            <div className="relative flex-1">
              <Input
                placeholder={t("schedule.cronPlaceholder")}
                value={cronInput}
                onChange={(e) => handleCronInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleApply();
                  }
                }}
                disabled={disabled}
                className={cn(
                  "font-mono text-xs border-2 rounded-[4px] h-9 pr-8",
                  cronError
                    ? "border-destructive focus:border-destructive"
                    : "border-border/40 focus:border-border",
                )}
              />
              {/* Re-roll button for preset modes */}
              {value.enabled &&
                value.preset !== "none" &&
                value.preset !== "custom" && (
                  <button
                    type="button"
                    onClick={handleReroll}
                    disabled={disabled}
                    title={t("schedule.randomise")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </button>
                )}
            </div>

            {/* Apply */}
            <Button
              type="button"
              size="sm"
              onClick={handleApply}
              disabled={disabled || !cronInput || !!cronError}
              className="h-9 px-3 text-xs border-2 border-border rounded-[4px] font-mono font-semibold bg-foreground text-primary-foreground hover:bg-accent hover:text-accent-foreground transition-colors shrink-0"
            >
              Apply
            </Button>
          </div>

          {/* Cron caption / error */}
          {cronError ? (
            <p className="text-[10px] text-destructive font-mono pl-0.5">
              {cronError}
            </p>
          ) : cronDescription ? (
            <p className="text-[10px] text-muted-foreground font-mono pl-0.5">
              {cronDescription}
            </p>
          ) : (
            <p className="text-[10px] text-muted-foreground font-mono pl-0.5">
              5 fields:{" "}
              <span className="text-foreground/70">
                minute · hour · day · month · weekday
              </span>
            </p>
          )}
        </div>

        {/* ── Disabled hint ──────────────────────────────────────────────────── */}
        {!value.enabled && (
          <p className="text-[11px] text-muted-foreground font-mono text-center py-1">
            Toggle on to enable automated ingestion
          </p>
        )}

        {/* ── Save button (edit mode only) ──────────────────────────────────── */}
        {onSave && (
          <Button
            type="button"
            className="w-full rounded-[4px] border-2 border-border bg-foreground text-primary-foreground hover:bg-accent hover:text-accent-foreground h-9 text-xs font-mono uppercase tracking-[0.08em] transition-colors"
            onClick={handleSave}
            disabled={disabled || isSaving}
          >
            {isSaving ? "Saving…" : "Apply Schedule"}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Default value helper ──────────────────────────────────────────────────────

export function defaultScheduleValue(schedule?: {
  enabled?: boolean;
  preset?: string;
  cron?: string;
  timezone?: string;
}): ScheduleValue {
  if (!schedule) {
    return { enabled: false, preset: "none", cron: "", timezone: "UTC" };
  }
  return {
    enabled: schedule.enabled ?? false,
    preset: (schedule.preset as SchedulePreset) ?? "none",
    cron: schedule.cron ?? "",
    timezone: schedule.timezone ?? "UTC",
  };
}
