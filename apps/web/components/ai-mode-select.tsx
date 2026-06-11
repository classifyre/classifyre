"use client";

import * as React from "react";
import { Bot } from "lucide-react";
import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";

export type AiMode = "INHERIT" | "MANAGED" | "OBSERVE_ONLY";

/**
 * Compact tri-state selector for the per-entity autopilot mode
 * (inquiry or case): inherit the instance setting, force managed,
 * or observe-only (AI reads but never mutates this entity).
 */
export function AiModeSelect({
  value,
  disabled,
  onChange,
}: {
  value: AiMode;
  disabled?: boolean;
  onChange: (mode: AiMode) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <Label
        className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground"
        title={t("settings.autopilot.aiModeDesc")}
      >
        <Bot className="h-3.5 w-3.5 text-[#d97706]" />
        {t("settings.autopilot.aiMode")}
      </Label>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(v) => void onChange(v as AiMode)}
      >
        <SelectTrigger className="h-8 w-[150px] rounded-[4px] border-2 border-border text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="INHERIT">
            {t("settings.autopilot.aiModeInherit")}
          </SelectItem>
          <SelectItem value="MANAGED">
            {t("settings.autopilot.aiModeManaged")}
          </SelectItem>
          <SelectItem value="OBSERVE_ONLY">
            {t("settings.autopilot.aiModeObserveOnly")}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
