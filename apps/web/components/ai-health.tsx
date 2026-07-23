"use client";

import { nsPath } from "@/lib/ns-path";
import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Wrench } from "lucide-react";
import { api } from "@workspace/api-client";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { useInstanceSettings } from "./instance-settings-provider";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

/**
 * Health of the AI/autopilot stack as a whole:
 * - `ok`             — a default provider is configured and passes a live
 *                      structured-JSON round-trip.
 * - `loading`        — still resolving (never warned on).
 * - `disabled`       — AI is switched off instance-wide.
 * - `not_configured` — AI is on but no provider is set as the default.
 * - `error`          — the default provider failed the live test (no connection,
 *                      no structured output, bad key, …). `detail` holds why.
 */
export type AiHealthStatus =
  | "ok"
  | "loading"
  | "disabled"
  | "not_configured"
  | "error";

interface AiHealthValue {
  status: AiHealthStatus;
  detail: string | null;
  recheck: () => void;
}

const AiHealthContext = React.createContext<AiHealthValue | null>(null);

export function AiHealthProvider({ children }: { children: React.ReactNode }) {
  const { settings, loading: settingsLoading } = useInstanceSettings();
  const [status, setStatus] = React.useState<AiHealthStatus>("loading");
  const [detail, setDetail] = React.useState<string | null>(null);

  const aiEnabled = settings.aiEnabled;
  const defaultProviderId = settings.aiProviderConfigId;

  const check = React.useCallback(async () => {
    if (settingsLoading) {
      setStatus("loading");
      return;
    }
    if (!aiEnabled) {
      setStatus("disabled");
      setDetail(null);
      return;
    }
    setStatus("loading");
    try {
      const providers =
        await api.aiProviderConfigs.aiProviderConfigControllerList();
      const target = defaultProviderId
        ? providers.find((p) => p.id === defaultProviderId)
        : null;
      if (!target) {
        // No provider, or none chosen as the default the assistant/autopilot use.
        setStatus("not_configured");
        setDetail(null);
        return;
      }
      // Live round-trip: verifies connection AND structured-JSON support.
      await api.aiProviderConfigs.aiProviderConfigControllerTest({
        id: target.id,
      });
      setStatus("ok");
      setDetail(null);
    } catch (e) {
      setStatus("error");
      setDetail(e instanceof Error ? e.message : null);
    }
  }, [aiEnabled, defaultProviderId, settingsLoading]);

  React.useEffect(() => {
    void check();
  }, [check]);

  const value = React.useMemo<AiHealthValue>(
    () => ({ status, detail, recheck: () => void check() }),
    [status, detail, check],
  );

  return (
    <AiHealthContext.Provider value={value}>
      {children}
    </AiHealthContext.Provider>
  );
}

export function useAiHealth(): AiHealthValue {
  const ctx = React.useContext(AiHealthContext);
  if (!ctx) {
    throw new Error("useAiHealth must be used within an AiHealthProvider");
  }
  return ctx;
}

/** True when there is something the operator should fix. */
function isUnhealthy(status: AiHealthStatus): boolean {
  return (
    status === "disabled" ||
    status === "not_configured" ||
    status === "error"
  );
}

/** Resolve the i18n title/description for a problem status. */
function useHealthCopy(status: AiHealthStatus, detail: string | null) {
  const { t } = useTranslation();
  const key = (suffix: string): TranslationKey =>
    `aiHealth.${status}.${suffix}` as TranslationKey;
  if (!isUnhealthy(status)) return null;
  const description =
    status === "error" && detail ? detail : t(key("desc"));
  return { title: t(key("title")), description, severity: status };
}

/**
 * Prominent sidebar warning. Renders as a sidebar menu item (collapses to an
 * amber icon with a tooltip) linking to Settings. Nothing when AI is healthy.
 */
export function AiHealthSidebarWarning() {
  const { status, detail } = useAiHealth();
  const { t } = useTranslation();
  const copy = useHealthCopy(status, detail);
  if (!copy) return null;

  const isError = status === "error";
  const colorClasses = isError
    ? "border-red-600/50 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-300"
    : "border-amber-600/50 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-300";

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        tooltip={`${copy.title} — ${copy.description}`}
        className={`h-auto items-start gap-2 border-2 ${colorClasses}`}
      >
        <Link href={nsPath("/settings")}>
          <AlertTriangle className="size-5 shrink-0" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-xs font-semibold">{copy.title}</span>
            <span className="truncate text-[11px] opacity-90">
              {t("aiHealth.fixInSettings")}
            </span>
          </span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * Top-bar "fix" notification. A compact pill linking to Settings, shown only
 * when the AI stack needs attention.
 */
export function AiHealthFixButton() {
  const { status, detail } = useAiHealth();
  const copy = useHealthCopy(status, detail);
  const { t } = useTranslation();
  if (!copy) return null;

  const isError = status === "error";
  const colorClasses = isError
    ? "border-red-600/40 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-950/40 dark:text-red-400"
    : "border-amber-600/40 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-400";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={nsPath("/settings")}
          className={`flex items-center gap-1.5 rounded-[4px] border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] transition-colors ${colorClasses}`}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{copy.title}</span>
          <span className="flex items-center gap-0.5">
            <Wrench className="h-3 w-3" />
            {t("aiHealth.fix")}
          </span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="max-w-xs">
        {copy.description}
      </TooltipContent>
    </Tooltip>
  );
}
