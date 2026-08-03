"use client";

import * as React from "react";
import { CalendarClock, RefreshCw, AlertCircle } from "lucide-react";
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

/** Which scheduler owns the source. Mirrors the API's SourceScheduleMode. */
export type ScheduleMode = "OFF" | "CRON" | "AUTO";

export type ScheduleValue = {
  /** Kept as the OFF/on switch so existing call sites read the same. */
  enabled: boolean;
  mode: ScheduleMode;
  preset: SchedulePreset;
  cron: string;
  timezone: string;
};

export type AutoSchedulePhase = "CATCH_UP" | "STEADY" | "BACKOFF" | "PAUSED";

/** Live adaptive-schedule state, when the source already has one. */
export type AutoScheduleStatus = {
  phase: AutoSchedulePhase;
  nextRunAt?: string | Date | null;
  reason?: string | null;
};

const PHASE_TONE: Record<AutoSchedulePhase, string> = {
  CATCH_UP: "border-accent/50 text-accent bg-accent/10",
  STEADY: "border-border/40 text-muted-foreground bg-foreground/5",
  BACKOFF: "border-destructive/40 text-destructive bg-destructive/10",
  PAUSED: "border-destructive/60 text-destructive bg-destructive/10",
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
  error?: string;
  /** Live phase of an existing automatic schedule, when there is one. */
  autoStatus?: AutoScheduleStatus | null;
  /** Clear a PAUSED circuit breaker. Omit to hide the resume action. */
  onResume?: () => Promise<void>;
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function ScheduleCard({
  value,
  onChange,
  onSave,
  disabled,
  className,
  error,
  autoStatus,
  onResume,
}: ScheduleCardProps) {
  const { t } = useTranslation();

  const PRESETS: {
    value: Exclude<SchedulePreset, "none" | "custom">;
    label: string;
    hint: string;
  }[] = [
    {
      value: "nightly",
      label: t("schedule.presets.nightly"),
      hint: t("schedule.hints.nightly"),
    },
    {
      value: "daily",
      label: t("schedule.presets.daily"),
      hint: t("schedule.hints.daily"),
    },
    {
      value: "weekday_morning",
      label: t("schedule.presets.weekdayAm"),
      hint: t("schedule.hints.weekdayAm"),
    },
    {
      value: "weekday_business",
      label: t("schedule.presets.businessHours"),
      hint: t("schedule.hints.businessHours"),
    },
    {
      value: "weekly",
      label: t("schedule.presets.weekly"),
      hint: t("schedule.hints.weekly"),
    },
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
      onChange({
        ...value,
        enabled: false,
        mode: "OFF",
        preset: "none",
        cron: "",
      });
      return;
    }
    // Default to automatic: it is right for almost every source, and picking a
    // wall-clock time is only meaningful once you know how long a scan takes.
    handleModeChange(value.mode === "CRON" ? "CRON" : "AUTO");
  };

  const handleModeChange = (mode: Exclude<ScheduleMode, "OFF">) => {
    if (mode === "AUTO") {
      onChange({ ...value, enabled: true, mode: "AUTO" });
      return;
    }
    const preset: Exclude<SchedulePreset, "none" | "custom"> =
      value.preset === "none" || value.preset === "custom"
        ? "nightly"
        : (value.preset as Exclude<SchedulePreset, "none" | "custom">);
    onChange({
      ...value,
      enabled: true,
      mode: "CRON",
      preset,
      cron: value.cron || generateCronForPreset(preset),
    });
  };

  const handlePresetSelect = (
    preset: Exclude<SchedulePreset, "none" | "custom">,
  ) => {
    onChange({
      ...value,
      enabled: true,
      mode: "CRON",
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
    onChange({
      ...value,
      preset: "custom",
      enabled: true,
      mode: "CRON",
      cron: cronInput,
    });
    setCronError("");
  };

  const handleSave = async () => {
    if (!onSave) return;
    if (value.mode === "CRON" && cronInput && !isValidCron(cronInput)) {
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

  const [isResuming, setIsResuming] = React.useState(false);

  const PHASE_LABEL: Record<AutoSchedulePhase, string> = {
    CATCH_UP: t("schedule.phaseCatchUp"),
    STEADY: t("schedule.phaseSteady"),
    BACKOFF: t("schedule.phaseBackoff"),
    PAUSED: t("schedule.phasePaused"),
  };

  const handleResume = async () => {
    if (!onResume) return;
    try {
      setIsResuming(true);
      await onResume();
    } finally {
      setIsResuming(false);
    }
  };

  const isPresetActive = (preset: string) =>
    value.enabled && value.mode === "CRON" && value.preset === preset;

  const cronDescription = isValidCron(value.cron)
    ? describeCronLocal(value.cron)
    : "";

  // The cron controls belong to the fixed mode only. While the schedule is off
  // — the default for a new source — the mode selector is what should show.
  const showCron = value.enabled && value.mode === "CRON";

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
          {value.enabled &&
            (value.mode === "AUTO" ? (
              <Badge
                variant="outline"
                className={cn(
                  "h-5 px-1.5 text-[10px] font-mono uppercase tracking-wider",
                  autoStatus
                    ? PHASE_TONE[autoStatus.phase]
                    : "border-accent/50 text-accent bg-accent/10",
                )}
              >
                {autoStatus ? PHASE_LABEL[autoStatus.phase] : "Automatic"}
              </Badge>
            ) : (
              value.cron && (
                <Badge
                  variant="outline"
                  className="h-5 px-1.5 text-[10px] font-mono border-accent/50 text-accent bg-accent/10 uppercase tracking-wider"
                >
                  Active
                </Badge>
              )
            ))}
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
        {/* ── Mode selector ─────────────────────────────────────────────────── */}
        {value.enabled && (
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                {
                  mode: "AUTO" as const,
                  label: t("schedule.modeAutomatic"),
                  hint: t("schedule.modeAutomaticHint"),
                },
                {
                  mode: "CRON" as const,
                  label: t("schedule.modeFixed"),
                  hint: t("schedule.modeFixedHint"),
                },
              ] as const
            ).map((option) => {
              const active = value.mode === option.mode;
              return (
                <button
                  key={option.mode}
                  type="button"
                  onClick={() => handleModeChange(option.mode)}
                  disabled={disabled}
                  className={cn(
                    "flex flex-col items-start gap-0.5 rounded-[4px] border-2 px-3 py-2 text-left transition-all",
                    active
                      ? "border-border bg-foreground text-primary-foreground shadow-[2px_2px_0_var(--color-border)]"
                      : "border-border/20 hover:border-border hover:bg-foreground/5",
                  )}
                >
                  <span className="text-xs font-semibold leading-tight">
                    {option.label}
                  </span>
                  <span
                    className={cn(
                      "text-[10px] font-mono",
                      active
                        ? "text-primary-foreground/60"
                        : "text-muted-foreground",
                    )}
                  >
                    {option.hint}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Automatic mode ────────────────────────────────────────────────── */}
        {value.enabled && value.mode === "AUTO" && (
          <div className="space-y-3">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t("schedule.autoExplainer")}
            </p>
            {autoStatus && (
              <div className="rounded-[4px] border-2 border-border/20 bg-foreground/5 px-3 py-2 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                    {t("schedule.status")}
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {autoStatus.nextRunAt
                      ? t("schedule.nextScan", {
                          time: new Date(autoStatus.nextRunAt).toLocaleString(),
                        })
                      : t("schedule.noScanQueued")}
                  </span>
                </div>
                {autoStatus.reason && (
                  <p className="text-[11px] text-foreground/80">
                    {autoStatus.reason}
                  </p>
                )}
                {autoStatus.phase === "PAUSED" && onResume && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleResume}
                    disabled={disabled || isResuming}
                    className="mt-1 h-7 px-2 text-[11px] border-2 border-border rounded-[4px] font-mono bg-foreground text-primary-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    {isResuming ? t("schedule.resuming") : t("schedule.resume")}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Preset frequency grid ─────────────────────────────────────────── */}
        {showCron && (
          <>
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

            {/* ── Cron input row ────────────────────────────────────────── */}
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
                    value.mode === "CRON" &&
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
          </>
        )}

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
      {error && (
        <div className="flex items-center gap-1.5 px-3 py-2 rounded-[4px] bg-destructive/10 text-destructive text-[10px] font-mono">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}

// ─── Default value helper ──────────────────────────────────────────────────────

export function defaultScheduleValue(schedule?: {
  enabled?: boolean;
  mode?: string | null;
  preset?: string;
  cron?: string;
  timezone?: string;
}): ScheduleValue {
  if (!schedule) {
    return {
      enabled: false,
      mode: "OFF",
      preset: "none",
      cron: "",
      timezone: "UTC",
    };
  }
  // `mode` is authoritative when the API sent one. Older callers (and the
  // source examples, which only carry a cron) fall back to the enabled flag, so
  // anything with a cron is a fixed schedule.
  const mode: ScheduleMode =
    schedule.mode === "AUTO" || schedule.mode === "CRON"
      ? schedule.mode
      : schedule.mode === "OFF"
        ? "OFF"
        : schedule.enabled
          ? "CRON"
          : "OFF";
  return {
    enabled: mode !== "OFF",
    mode,
    preset: (schedule.preset as SchedulePreset) ?? "none",
    cron: schedule.cron ?? "",
    timezone: schedule.timezone ?? "UTC",
  };
}

/**
 * The source create/update payload for a schedule value. One place, so the new
 * and edit pages cannot drift on what "automatic" means on the wire.
 */
export function scheduleFieldsFor(value: ScheduleValue): {
  scheduleMode: ScheduleMode;
  scheduleEnabled: boolean;
  scheduleCron?: string;
  scheduleTimezone?: string;
} {
  if (value.mode === "AUTO") {
    return { scheduleMode: "AUTO", scheduleEnabled: false };
  }
  if (value.mode === "CRON" && value.cron) {
    return {
      scheduleMode: "CRON",
      scheduleEnabled: true,
      scheduleCron: value.cron,
      scheduleTimezone: value.timezone,
    };
  }
  return { scheduleMode: "OFF", scheduleEnabled: false };
}
