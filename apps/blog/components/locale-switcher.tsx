"use client";

import { usePathname, useRouter } from "next/navigation";
import { Globe } from "lucide-react";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components";

import { translate } from "@/i18n";
import {
  alternateLocalePath,
  localeToLanguage,
  stripLocalePrefix,
  writeLocaleCookie,
  type Locale,
  type ResolvedLanguage,
} from "@/lib/locale";

/**
 * Language switcher in the navbar — the same component pattern as the web
 * app toolbar (`apps/web/components/language-switcher.tsx`): a ghost Globe
 * button opening a dropdown with English/Deutsch radio items.
 *
 * Language is addressable, so switching is a navigation, not just a
 * preference: the `/de` prefix decides `<html lang>` and every
 * server-rendered title. The `NEXT_LOCALE` cookie is still written — it is
 * what the automatic redirect on unprefixed entry URLs reads, so an explicit
 * choice survives even when the browser language disagrees.
 */
export function LocaleSwitcher({ locale }: { locale: Locale }) {
  const router = useRouter();
  const pathname = usePathname();
  const current: ResolvedLanguage = localeToLanguage(locale);

  const switchLanguage = (language: ResolvedLanguage) => {
    writeLocaleCookie(language === "GERMAN" ? "de" : "en");

    // Query and hash come from `window` rather than `useSearchParams()`: this
    // runs in a click handler, and the hook would force every page mounting
    // this switcher into a client-side render bailout at build time.
    const suffix =
      typeof window === "undefined"
        ? ""
        : window.location.search + window.location.hash;
    const base = pathname ?? "/";
    const target = alternateLocalePath(base);
    // `alternateLocalePath` toggles; when the user picks the language they
    // already read, stay (but the cookie above still records the choice).
    const stay =
      (language === "GERMAN" && stripLocalePrefix(base).locale === "de") ||
      (language === "ENGLISH" && stripLocalePrefix(base).locale === "en");
    const destination = stay
      ? `${base.endsWith("/") ? base : `${base}/`}${suffix}`
      : `${target}${suffix}`;
    router.replace(destination);
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
          <span className="sr-only">{translate(locale, "chrome.language")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(value) => {
            switchLanguage(value as ResolvedLanguage);
          }}
        >
          <DropdownMenuRadioItem value="ENGLISH">
            {translate(locale, "chrome.englishName")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="GERMAN">
            {translate(locale, "chrome.germanName")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
