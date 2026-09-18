"use client";

import { usePathname, useRouter } from "next/navigation";
import { Select } from "nextra/components";
import { Globe } from "lucide-react";

import { translate } from "@/i18n";
import {
  alternateLocalePath,
  localeToLanguage,
  writeLocaleCookie,
  type Locale,
  type ResolvedLanguage,
} from "@/lib/locale";

/**
 * Language switcher in the navbar, built on Nextra's own `Select` — the same
 * control the docs theme uses for its locale switch.
 *
 * The previous Radix dropdown ran in modal mode: opening it locked body
 * scroll, so the theme compensated with a `padding-right` that shoved the
 * whole page left and left a gap on the right, and its portal + focus
 * management fought the sticky navbar after scrolling. `Select` is a
 * non-modal Headless Listbox: no overlay, no scroll lock, no body mutation,
 * so the navbar cannot shift or vanish.
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
    // runs in a change handler, and the hook would force every page mounting
    // this switcher into a client-side render bailout at build time.
    const suffix =
      typeof window === "undefined"
        ? ""
        : window.location.search + window.location.hash;
    // `Select` only fires on an actual change, so the toggle always targets
    // the other language.
    router.replace(`${alternateLocalePath(pathname ?? "/")}${suffix}`);
  };

  return (
    <Select
      title={translate(locale, "chrome.language")}
      value={current}
      selectedOption={<Globe className="h-5 w-5" />}
      onChange={(value) => {
        switchLanguage(value as ResolvedLanguage);
      }}
      options={[
        { id: "ENGLISH", name: translate(locale, "chrome.englishName") },
        { id: "GERMAN", name: translate(locale, "chrome.germanName") },
      ]}
    />
  );
}
