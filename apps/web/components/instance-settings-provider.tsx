"use client";

import * as React from "react";
import { usePathname } from "next/navigation.js";
import {
  api,
  namespaceSlugFromPath,
  InstanceSettingsResponseDtoLanguageEnum,
  InstanceSettingsResponseDtoTimeFormatEnum,
} from "@workspace/api-client";
import { setDateFormattingPreferences } from "@/lib/date";
import {
  resolveLanguage,
  resolveTimeFormat,
  resolveTimezone,
  type LanguageSetting,
  type ResolvedLanguage,
  type ResolvedTimeFormat,
  type TimeFormatSetting,
} from "@/lib/locale-detection";
import {
  getLanguageOverride,
  setLanguageOverride as persistOverride,
} from "@/lib/language-cookie";

type InstanceSettingsResponse = Awaited<
  ReturnType<typeof api.instanceSettings.instanceSettingsControllerGetSettings>
>;

type UpdateInstanceSettingsPayload = NonNullable<
  Parameters<
    typeof api.instanceSettings.instanceSettingsControllerUpdateSettings
  >[0]
>["updateInstanceSettingsDto"];

type InstanceSettingsContextValue = {
  settings: InstanceSettingsResponse;
  /** The language actually used for rendering (never AUTOMATIC). */
  resolvedLanguage: ResolvedLanguage;
  /** The effective language setting (cookie override or instance default). */
  effectiveLanguageSetting: LanguageSetting;
  /** The resolved time format (never AUTOMATIC). */
  resolvedTimeFormat: ResolvedTimeFormat;
  /** The resolved IANA timezone string (never AUTOMATIC). */
  resolvedTimezone: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Update instance-wide settings via API (used by Settings page). */
  updateSettings: (
    payload: UpdateInstanceSettingsPayload,
  ) => Promise<InstanceSettingsResponse>;
  /** Set per-user language override cookie (used by header switcher). No API call. */
  setLanguageOverride: (setting: LanguageSetting) => void;
};

const DEFAULT_SETTINGS: InstanceSettingsResponse = {
  id: 1,
  mcpEnabled: true,
  demoMode: false,
  language: InstanceSettingsResponseDtoLanguageEnum.Automatic,
  timezone: "AUTOMATIC",
  timeFormat: InstanceSettingsResponseDtoTimeFormatEnum.Automatic,
  aiProviderConfigId: null,
  harnessAiProviderConfigId: null,
  autopilotInquiryEnabled: true,
  autopilotCaseEnabled: true,
  autopilotConfigEnabled: true,
  autopilotDetectorEnabled: true,
  autopilotEscalationEnabled: true,
  autopilotMcpEnabled: true,
  // Harness limits. These must mirror the schema defaults: the provider serves
  // them before the first fetch resolves, and a control reading `undefined`
  // renders empty and then jumps.
  harnessRunBudgetMinutes: 20,
  harnessRunStaleAfterMinutes: 60,
  harnessCycleBudgetMinutes: 30,
  harnessEvidenceUsableFindings: 2000,
  harnessEvidenceUsableCoverage: 0.25,
  harnessEvidenceWarnCoverage: 0.8,
  harnessExpressImportance: 0.75,
  harnessObservationChars: 8000,
  harnessTurnObservationChars: 24000,
  harnessMaxRankedFindings: 25,
  harnessMaxGlossaryEntries: 20,
  harnessMaxRecalledMemories: 30,
  harnessDreamIntervalDays: 2,
  autoScheduleEnabled: true,
  maxConcurrentRunners: 2,
  hfTokenSet: false,
  hfTokenInstanceSet: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const InstanceSettingsContext =
  React.createContext<InstanceSettingsContextValue | null>(null);

export function InstanceSettingsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [settings, setSettings] =
    React.useState<InstanceSettingsResponse>(DEFAULT_SETTINGS);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Per-user cookie override. null = no override, use instance default.
  const [languageOverride, setLanguageOverrideState] =
    React.useState<LanguageSetting | null>(() => getLanguageOverride());

  const refresh = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response =
        await api.instanceSettings.instanceSettingsControllerGetSettings();
      setSettings(response);
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "Failed to load instance settings";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateSettings = React.useCallback(
    async (payload: UpdateInstanceSettingsPayload) => {
      try {
        setSaving(true);
        setError(null);

        const response =
          await api.instanceSettings.instanceSettingsControllerUpdateSettings({
            updateInstanceSettingsDto: payload,
          });

        setSettings(response);
        return response;
      } catch (updateError) {
        const message =
          updateError instanceof Error
            ? updateError.message
            : "Failed to update instance settings";
        setError(message);
        throw updateError;
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  // Header switcher: save to cookie, no API call
  const setLanguageOverride = React.useCallback(
    (setting: LanguageSetting) => {
      persistOverride(setting);
      setLanguageOverrideState(setting);
    },
    [],
  );

  // ─── Resolution ──────────────────────────────────────────────────

  const effectiveLanguageSetting: LanguageSetting =
    languageOverride ?? (settings.language as LanguageSetting);

  const resolvedLanguage = React.useMemo<ResolvedLanguage>(
    () => resolveLanguage(effectiveLanguageSetting),
    [effectiveLanguageSetting],
  );

  const resolvedTimeFormat = React.useMemo<ResolvedTimeFormat>(
    () => resolveTimeFormat(settings.timeFormat as TimeFormatSetting),
    [settings.timeFormat],
  );

  const resolvedTimezone = React.useMemo<string>(
    () => resolveTimezone(settings.timezone),
    [settings.timezone],
  );

  // Apply date preferences whenever any resolved value changes
  React.useEffect(() => {
    setDateFormattingPreferences({
      language: resolvedLanguage,
      timezone: resolvedTimezone,
      timeFormat: resolvedTimeFormat,
    });
  }, [resolvedLanguage, resolvedTimezone, resolvedTimeFormat]);

  // Instance settings are per-namespace, and this provider wraps the whole app
  // — including the workspace directory, which sits outside every namespace.
  // Fetch only once a tenant is in the route (and refetch when it changes),
  // otherwise the request 404s as `Unknown namespace 'instance-settings'`.
  const namespaceSlug = namespaceSlugFromPath(usePathname());

  React.useEffect(() => {
    if (!namespaceSlug) {
      setLoading(false);
      return;
    }
    void refresh();
  }, [refresh, namespaceSlug]);

  const value = React.useMemo<InstanceSettingsContextValue>(
    () => ({
      settings,
      resolvedLanguage,
      effectiveLanguageSetting,
      resolvedTimeFormat,
      resolvedTimezone,
      loading,
      saving,
      error,
      refresh,
      updateSettings,
      setLanguageOverride,
    }),
    [
      settings,
      resolvedLanguage,
      effectiveLanguageSetting,
      resolvedTimeFormat,
      resolvedTimezone,
      loading,
      saving,
      error,
      refresh,
      updateSettings,
      setLanguageOverride,
    ],
  );

  return (
    <InstanceSettingsContext.Provider value={value}>
      {children}
    </InstanceSettingsContext.Provider>
  );
}

export function useInstanceSettings() {
  const context = React.useContext(InstanceSettingsContext);
  if (!context) {
    throw new Error(
      "useInstanceSettings must be used within InstanceSettingsProvider",
    );
  }
  return context;
}
