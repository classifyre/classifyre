"use client";

import * as React from "react";
import {
  Card,
  CardContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components";
import {
  InstanceSettingsResponseDtoLanguageEnum,
  InstanceSettingsResponseDtoTimeFormatEnum,
} from "@workspace/api-client";
import {
  BrainCircuit,
  Clock3,
  Globe,
  Languages,
  Loader2,
  Server,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { useInstanceSettings } from "@/components/instance-settings-provider";
import { McpSettingsCard } from "@/components/mcp-settings-card";
import { AiProvidersCard } from "@/components/ai-providers-card";
import { AiAssistantSettingsCard } from "@/components/ai-assistant-settings-card";
import { AutopilotSettingsCard } from "@/components/autopilot-settings-card";
import { VersionSettingsSection } from "@/components/version-update-notifier";
import { AppIcon } from "@/components/app-icon";
import { useTranslation } from "@/hooks/use-translation";

type SettingsDraft = {
  language: InstanceSettingsResponseDtoLanguageEnum;
  timezone: string;
  timeFormat: InstanceSettingsResponseDtoTimeFormatEnum;
};

const COMMON_TIMEZONES = [
  "UTC",
  "Europe/London",
  "Europe/Vienna",
  "Europe/Berlin",
  "Europe/Kyiv",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

function buildInitialDraft(settings: SettingsDraft): SettingsDraft {
  return {
    language: settings.language,
    timezone: settings.timezone,
    timeFormat: settings.timeFormat,
  };
}

function getTimezoneOffsetLabel(timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    const offset =
      parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
    const normalized = offset.replace(/^GMT/, "UTC");
    return normalized === "UTC" ? "UTC+00:00" : normalized;
  } catch {
    return "UTC+00:00";
  }
}

function getTimezoneLabel(timezone: string, autoLabel: string) {
  if (timezone === "AUTOMATIC") return autoLabel;
  return `${timezone} (${getTimezoneOffsetLabel(timezone)})`;
}

function getTimezoneOptions(currentTimezone: string) {
  const zones = Array.from(
    new Set(
      [...COMMON_TIMEZONES, currentTimezone].filter(
        (tz) => tz !== "AUTOMATIC",
      ),
    ),
  ).sort((a, b) => a.localeCompare(b));
  return ["AUTOMATIC", ...zones];
}

const TAB_TRIGGER_CLASS =
  "gap-2 px-1 text-xs font-mono uppercase tracking-[0.14em]";

export default function SettingsPage() {
  const { t } = useTranslation();
  const { settings, loading, saving, error, updateSettings } =
    useInstanceSettings();
  const [draft, setDraft] = React.useState<SettingsDraft>(() =>
    buildInitialDraft(settings),
  );
  const [saveLabel, setSaveLabel] = React.useState<"idle" | "saved" | "error">(
    "idle",
  );

  React.useEffect(() => {
    setDraft(buildInitialDraft(settings));
  }, [settings]);

  React.useEffect(() => {
    if (saveLabel !== "saved") return;

    const timeout = window.setTimeout(() => {
      setSaveLabel("idle");
    }, 1800);

    return () => window.clearTimeout(timeout);
  }, [saveLabel]);

  const timezoneOptions = React.useMemo(
    () => getTimezoneOptions(draft.timezone),
    [draft.timezone],
  );

  const persistSettings = React.useCallback(
    async (next: SettingsDraft) => {
      setDraft(next);

      try {
        await updateSettings({
          language: next.language,
          timezone: next.timezone,
          timeFormat: next.timeFormat,
        });
        setSaveLabel("saved");
      } catch (saveError) {
        setSaveLabel("error");
        toast.error(
          saveError instanceof Error
            ? saveError.message
            : "Failed to save settings",
        );
      }
    },
    [updateSettings],
  );

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="ml-2 text-sm">{t("settings.loading")}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <AppIcon name="settings" active size={28} />
            <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
              {t("settings.title")}
            </h1>
          </div>
          <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
            {saving
              ? t("settings.saving")
              : saveLabel === "saved"
                ? t("settings.saved")
                : saveLabel === "error"
                  ? t("settings.saveFailed")
                  : t("settings.autosaveOn")}
          </div>
        </div>
        <p className="text-muted-foreground">{t("settings.description")}</p>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <Tabs defaultValue="general" className="gap-5">
        <TabsList
          variant="line"
          className="h-auto w-full justify-start gap-6 border-b-2 border-border pb-0"
        >
          <TabsTrigger value="general" className={TAB_TRIGGER_CLASS}>
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {t("settings.tabs.global")}
          </TabsTrigger>
          <TabsTrigger value="ai-providers" className={TAB_TRIGGER_CLASS}>
            <BrainCircuit className="h-3.5 w-3.5" />
            {t("settings.tabs.aiProviders")}
          </TabsTrigger>
          <TabsTrigger value="mcp" className={TAB_TRIGGER_CLASS}>
            <Server className="h-3.5 w-3.5" />
            {t("settings.tabs.mcp")}
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="general"
          className="space-y-6 duration-300 animate-in fade-in-50 slide-in-from-bottom-1"
        >
          <Card className="panel-card rounded-[6px]">
            <CardContent className="p-5">
              <VersionSettingsSection />
            </CardContent>
          </Card>

          <Card className="panel-card rounded-[6px]">
            <CardContent className="space-y-6 p-5">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4" />
                <p className="text-xs font-mono uppercase tracking-[0.14em]">
                  {t("settings.regionHeading")}
                </p>
              </div>
              <p className="-mt-3 text-xs text-muted-foreground">
                {t("settings.regionDesc")}
              </p>

              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <Languages className="h-4 w-4 text-muted-foreground" />
                  <p className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
                    {t("settings.language")}
                  </p>
                </div>

                <div className="grid gap-2">
                  <Select
                    value={draft.language}
                    onValueChange={(value) => {
                      void persistSettings({
                        ...draft,
                        language:
                          value as InstanceSettingsResponseDtoLanguageEnum,
                      });
                    }}
                  >
                    <SelectTrigger className="h-10 rounded-[4px] border-2 border-border">
                      <SelectValue placeholder={t("settings.selectLanguage")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        value={InstanceSettingsResponseDtoLanguageEnum.Automatic}
                      >
                        {t("settings.languages.AUTOMATIC")}
                      </SelectItem>
                      <SelectItem
                        value={InstanceSettingsResponseDtoLanguageEnum.English}
                      >
                        {t("settings.languages.ENGLISH")}
                      </SelectItem>
                      <SelectItem
                        value={InstanceSettingsResponseDtoLanguageEnum.German}
                      >
                        {t("settings.languages.GERMAN")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-muted-foreground" />
                  <p className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
                    {t("settings.timeDefaults")}
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Select
                    value={draft.timeFormat}
                    onValueChange={(value) => {
                      void persistSettings({
                        ...draft,
                        timeFormat:
                          value as InstanceSettingsResponseDtoTimeFormatEnum,
                      });
                    }}
                  >
                    <SelectTrigger className="h-10 rounded-[4px] border-2 border-border">
                      <SelectValue
                        placeholder={t("settings.selectTimeFormat")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        value={
                          InstanceSettingsResponseDtoTimeFormatEnum.Automatic
                        }
                      >
                        {t("settings.languages.AUTOMATIC")}
                      </SelectItem>
                      <SelectItem
                        value={
                          InstanceSettingsResponseDtoTimeFormatEnum.TwelveHour
                        }
                      >
                        {t("settings.timeFormat12")}
                      </SelectItem>
                      <SelectItem
                        value={
                          InstanceSettingsResponseDtoTimeFormatEnum.TwentyFourHour
                        }
                      >
                        {t("settings.timeFormat24")}
                      </SelectItem>
                    </SelectContent>
                  </Select>

                  <Select
                    value={draft.timezone}
                    onValueChange={(value) => {
                      void persistSettings({ ...draft, timezone: value });
                    }}
                  >
                    <SelectTrigger className="h-10 rounded-[4px] border-2 border-border">
                      <div className="flex min-w-0 items-center gap-2">
                        <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <SelectValue
                          placeholder={t("settings.selectTimezone")}
                        />
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      {timezoneOptions.map((timezone) => (
                        <SelectItem key={timezone} value={timezone}>
                          {getTimezoneLabel(
                            timezone,
                            t("settings.languages.AUTOMATIC"),
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </section>
            </CardContent>
          </Card>

          <AiAssistantSettingsCard />

          <AutopilotSettingsCard />
        </TabsContent>

        <TabsContent
          value="ai-providers"
          className="duration-300 animate-in fade-in-50 slide-in-from-bottom-1"
        >
          <AiProvidersCard />
        </TabsContent>

        <TabsContent
          value="mcp"
          className="duration-300 animate-in fade-in-50 slide-in-from-bottom-1"
        >
          <McpSettingsCard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
