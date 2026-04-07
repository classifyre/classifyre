"use client";

import * as React from "react";
import {
  api,
  InstanceSettingsResponseDtoLanguageEnum,
  InstanceSettingsResponseDtoTimeFormatEnum,
} from "@workspace/api-client";
import { setDateFormattingPreferences } from "@/lib/date";

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
  loading: boolean;
  saving: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  updateSettings: (
    payload: UpdateInstanceSettingsPayload,
  ) => Promise<InstanceSettingsResponse>;
};

const DEFAULT_SETTINGS: InstanceSettingsResponse = {
  id: 1,
  aiEnabled: true,
  mcpEnabled: true,
  demoMode: false,
  language: InstanceSettingsResponseDtoLanguageEnum.English,
  timezone: "UTC",
  timeFormat: InstanceSettingsResponseDtoTimeFormatEnum.TwelveHour,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const InstanceSettingsContext =
  React.createContext<InstanceSettingsContextValue | null>(null);

function applyDatePreferences(settings: InstanceSettingsResponse) {
  setDateFormattingPreferences({
    language: settings.language,
    timezone: settings.timezone,
    timeFormat: settings.timeFormat,
  });
}

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

  const refresh = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response =
        await api.instanceSettings.instanceSettingsControllerGetSettings();
      setSettings(response);
      applyDatePreferences(response);
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "Failed to load instance settings";
      setError(message);
      applyDatePreferences(DEFAULT_SETTINGS);
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
        applyDatePreferences(response);
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

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = React.useMemo<InstanceSettingsContextValue>(
    () => ({
      settings,
      loading,
      saving,
      error,
      refresh,
      updateSettings,
    }),
    [settings, loading, saving, error, refresh, updateSettings],
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
