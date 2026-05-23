"use client";

import { Globe } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { InstanceSettingsResponseDtoLanguageEnum } from "@workspace/api-client";
import { useInstanceSettings } from "./instance-settings-provider";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

const LANGUAGE_OPTIONS: {
  value: InstanceSettingsResponseDtoLanguageEnum;
  labelKey: TranslationKey;
}[] = [
  {
    value: InstanceSettingsResponseDtoLanguageEnum.Automatic,
    labelKey: "settings.languages.AUTOMATIC",
  },
  {
    value: InstanceSettingsResponseDtoLanguageEnum.English,
    labelKey: "settings.languages.ENGLISH",
  },
  {
    value: InstanceSettingsResponseDtoLanguageEnum.German,
    labelKey: "settings.languages.GERMAN",
  },
];

export function LanguageSwitcher() {
  const { settings, updateSettings } = useInstanceSettings();
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative rounded-[4px] border-2 border-transparent hover:border-border"
        >
          <Globe className="h-5 w-5" />
          <span className="sr-only">{t("common.language")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={settings.language}
          onValueChange={(value) => {
            void updateSettings({
              language: value as InstanceSettingsResponseDtoLanguageEnum,
            });
          }}
        >
          {LANGUAGE_OPTIONS.map((opt) => (
            <DropdownMenuRadioItem key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
