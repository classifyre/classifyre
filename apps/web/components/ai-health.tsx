"use client";

import { useNsPath } from "@/lib/ns-path";
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
import { useServerConfig } from "./server-config-provider";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

/**
 * Health of the Harness configuration shown in the global navigation:
 * - `ok`             — Harness has a provider that passes a live round-trip.
 * - `loading`        — still resolving (never warned on).
 * - `not_configured` — Harness has no provider assigned.
 * - `error`          — an assigned provider failed the live test (no connection,
 *                      no structured output, bad key, …). `detail` holds why.
 * - `unavailable`    — demo mode: never probed, never warned on. The probe is a
 *                      mutating call the demo guard rejects anyway, and the
 *                      provider is not something a demo visitor could fix.
 */
export type AiHealthStatus =
  | "ok"
  | "loading"
  | "not_configured"
  | "error"
  | "unavailable";

interface AiHealthValue {
  status: AiHealthStatus;
  detail: string | null;
  recheck: () => void;
}

const AiHealthContext = React.createContext<AiHealthValue | null>(null);

export function AiHealthProvider({ children }: { children: React.ReactNode }) {
  const { settings, loading: settingsLoading } = useInstanceSettings();
  const serverConfig = useServerConfig();
  const [status, setStatus] = React.useState<AiHealthStatus>("loading");
  const [detail, setDetail] = React.useState<string | null>(null);

  const harnessProviderId = settings.harnessAiProviderConfigId;
  // Two sources on purpose. `serverConfig` is the web pod's own DEMO_MODE env,
  // known synchronously, so the probe is suppressed even before instance
  // settings arrive. `settings.demoMode` is what the API actually enforces and
  // covers deployments where only the API has the flag.
  const demoMode = serverConfig.demoMode || settings.demoMode;

  const check = React.useCallback(async () => {
    if (settingsLoading) {
      setStatus("loading");
      return;
    }
    // On a demo instance the provider probe (POST .../test) is blocked by the
    // read-only guard, so running it would only ever produce a red "AI provider
    // problem — Fix" banner pointing at a Settings page the visitor cannot
    // change. Skip the request entirely.
    if (demoMode) {
      setStatus("unavailable");
      setDetail(null);
      return;
    }
    if (!harnessProviderId) {
      setStatus("not_configured");
      setDetail(null);
      return;
    }
    setStatus("loading");
    try {
      const providers =
        await api.aiProviderConfigs.aiProviderConfigControllerList();
      if (!providers.some((provider) => provider.id === harnessProviderId)) {
        setStatus("not_configured");
        setDetail(null);
        return;
      }
      const result = await api.aiProviderConfigs.aiProviderConfigControllerTest(
        {
          id: harnessProviderId,
        },
      );
      if (result.status === "FAIL") {
        setStatus("error");
        setDetail(result.message);
        return;
      }
      setStatus("ok");
      setDetail(null);
    } catch (e) {
      setStatus("error");
      setDetail(e instanceof Error ? e.message : null);
    }
  }, [demoMode, harnessProviderId, settingsLoading]);

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

/**
 * The AI health verdict, or null when there is no provider above.
 *
 * For components that merely *offer* an AI feature. Throwing there would let a
 * toolbar button take down the whole form it sits in when it is rendered
 * outside the dashboard shell — and "no provider" and "not configured" mean the
 * same thing to a button: show the disabled state.
 */
export function useOptionalAiHealth(): AiHealthValue | null {
  return React.useContext(AiHealthContext);
}

export function useAiHealth(): AiHealthValue {
  const ctx = React.useContext(AiHealthContext);
  if (!ctx) {
    throw new Error("useAiHealth must be used within an AiHealthProvider");
  }
  return ctx;
}

/** True when there is something the operator should fix. `unavailable` is
 * deliberately excluded: nothing is broken and nobody viewing a demo can act
 * on it, so neither the sidebar warning nor the top-bar pill renders. */
function isUnhealthy(status: AiHealthStatus): boolean {
  return status === "not_configured" || status === "error";
}

/** Resolve the i18n title/description for a problem status. */
function useHealthCopy(status: AiHealthStatus, detail: string | null) {
  const { t } = useTranslation();
  const key = (suffix: string): TranslationKey =>
    `aiHealth.${status}.${suffix}` as TranslationKey;
  if (!isUnhealthy(status)) return null;
  const description = status === "error" && detail ? detail : t(key("desc"));
  return { title: t(key("title")), description, severity: status };
}

/**
 * Prominent sidebar warning. Renders as a sidebar menu item (collapses to an
 * amber icon with a tooltip) linking to Harness configuration. Nothing when AI
 * is healthy.
 */
export function AiHealthSidebarWarning() {
  const nsPath = useNsPath();
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
        <Link href={nsPath("/harness?tab=config")}>
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
 * Top-bar "fix" notification. A compact pill linking directly to Harness
 * configuration, shown only when the AI stack needs attention.
 */
export function AiHealthFixButton() {
  const nsPath = useNsPath();
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
          href={nsPath("/harness?tab=config")}
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
