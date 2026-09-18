"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { api } from "@workspace/api-client";
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
 * Inline status marker for the Harness AI sidebar entry. Renders nothing when
 * AI is healthy — otherwise an amber (warning) or red (error) icon pinned to
 * the right of the Harness label, with the problem as its tooltip. The entry
 * itself already links to Harness, so no separate banner or link is needed.
 */
export function AiHealthHarnessStatus() {
  const { status, detail } = useAiHealth();
  const copy = useHealthCopy(status, detail);
  if (!copy) return null;

  const isError = status === "error";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid="ai-health-harness-status"
          data-status={status}
          role="img"
          aria-label={`${copy.title} — ${copy.description}`}
          className={
            isError
              ? "flex shrink-0 items-center text-red-600 dark:text-red-400"
              : "flex shrink-0 items-center text-amber-600 dark:text-amber-400"
          }
        >
          <AlertTriangle className="size-4" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="max-w-xs">
        <span className="block text-xs font-semibold">{copy.title}</span>
        <span className="block text-xs opacity-90">{copy.description}</span>
      </TooltipContent>
    </Tooltip>
  );
}
