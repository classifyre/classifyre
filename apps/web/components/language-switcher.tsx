"use client";

import { useRouter, usePathname } from "next/navigation";
import { Button } from "@workspace/ui/components/button";
import { Globe } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { useInstanceSettings } from "./instance-settings-provider";
import { useTranslation } from "@/hooks/use-translation";
import { localeSwitchHref } from "@/lib/app-path";
import type { ResolvedLanguage } from "@/lib/locale-detection";
import type { TranslationKey } from "@/i18n";

const LANGUAGE_OPTIONS: {
  value: ResolvedLanguage;
  labelKey: TranslationKey;
}[] = [
  { value: "ENGLISH", labelKey: "settings.languages.ENGLISH" },
  { value: "GERMAN", labelKey: "settings.languages.GERMAN" },
];

export function LanguageSwitcher() {
  const { resolvedLanguage, setLanguageOverride } = useInstanceSettings();
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();

  /**
   * Language is addressable, so switching it is a navigation, not just a
   * preference: the URL prefix decides `<html lang>` and every server-rendered
   * title. The cookie is still written — it is what the desktop build (which
   * has no rewrites) and any unprefixed entry URL read.
   */
  const switchLanguage = (language: ResolvedLanguage) => {
    setLanguageOverride(language);

    // Query and hash come from `window` rather than `useSearchParams()`: this
    // runs in a click handler, and the hook would force every page mounting
    // this switcher — including the workspace directory — into a client-side
    // render bailout at build time.
    const suffix =
      typeof window === "undefined"
        ? ""
        : window.location.search + window.location.hash;
    router.replace(localeSwitchHref(pathname ?? "/", language, suffix));
  };

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
          value={resolvedLanguage}
          onValueChange={(value) => {
            switchLanguage(value as ResolvedLanguage);
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
