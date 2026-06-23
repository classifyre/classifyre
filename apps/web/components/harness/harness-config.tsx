"use client";

import * as React from "react";
import { Switch } from "@workspace/ui/components";
import { Plug } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@workspace/ui/lib/utils";
import { useInstanceSettings } from "@/components/instance-settings-provider";
import { useTranslation } from "@/hooks/use-translation";
import { HarnessMcp } from "./harness-mcp";

/**
 * Harness configuration — global switches that aren't per-agent. Per-agent
 * enable/goal/tool assignment lives in the Agents tab; this surface keeps the
 * external-MCP master toggle and the MCP server management it gates.
 */
export function HarnessConfig() {
  const { t } = useTranslation();
  const { settings, saving, updateSettings } = useInstanceSettings();
  const [busy, setBusy] = React.useState(false);

  const aiReady = settings.aiEnabled && !!settings.aiProviderConfigId;
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
    <div className="space-y-4">
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
    </div>
  );
}
