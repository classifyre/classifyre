"use client";

import * as React from "react";
import {
  api,
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
  aiEnabled: true,
  mcpEnabled: true,
  demoMode: false,
  s3Configured: true,
  language: InstanceSettingsResponseDtoLanguageEnum.Automatic,
  timezone: "AUTOMATIC",
  timeFormat: InstanceSettingsResponseDtoTimeFormatEnum.Automatic,
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

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

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
