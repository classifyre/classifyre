import fs from "node:fs";
import path from "node:path";

import { localeSwitchHref } from "./app-path";

import {
  DEFAULT_LOCALE,
  LOCALES,
  isLocale,
  languageToLocale,
  localeHtmlLang,
  localeOpenGraph,
  localePathPrefix,
  localeToLanguage,
  stripLocalePrefix,
  withLocalePrefix,
  resolveLocaleTag,
  detectBrowserLanguage,
  resolveLanguage,
  detectBrowserTimeFormat,
  resolveTimeFormat,
  detectBrowserTimezone,
  resolveTimezone,
  AUTOMATIC_TIMEZONE,
} from "./locale-detection";
import {
  getLanguageOverride,
  setLanguageOverride,
  clearLanguageOverride,
} from "./language-cookie";

// ─── resolveLocaleTag ───────────────────────────────────────────────

describe("resolveLocaleTag", () => {
  it.each([
    ["de", "GERMAN"],
    ["de-DE", "GERMAN"],
    ["de-CH", "GERMAN"],
    ["de-AT", "GERMAN"],
    ["DE", "GERMAN"],
    ["De-de", "GERMAN"],
  ] as const)("maps %s to %s", (tag, expected) => {
    expect(resolveLocaleTag(tag)).toBe(expected);
  });

  it.each([
    ["en", "ENGLISH"],
    ["en-US", "ENGLISH"],
    ["en-GB", "ENGLISH"],
    ["fr-FR", "ENGLISH"],
    ["es", "ENGLISH"],
    ["ja-JP", "ENGLISH"],
    ["", "ENGLISH"],
  ] as const)("maps %s to ENGLISH (fallback)", (tag, expected) => {
    expect(resolveLocaleTag(tag)).toBe(expected);
  });
});

// ─── detectBrowserLanguage ──────────────────────────────────────────

describe("detectBrowserLanguage", () => {
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  it("returns GERMAN when navigator.languages includes a de variant", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: { languages: ["de-AT", "en-US"], language: "de-AT" },
      writable: true,
      configurable: true,
    });
    expect(detectBrowserLanguage()).toBe("GERMAN");
  });

  it("returns GERMAN from navigator.language when languages is empty", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: { languages: [], language: "de" },
      writable: true,
      configurable: true,
    });
    expect(detectBrowserLanguage()).toBe("GERMAN");
  });

  it("returns ENGLISH when no supported language is found", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: { languages: ["fr-FR", "es-ES"], language: "fr-FR" },
      writable: true,
      configurable: true,
    });
    expect(detectBrowserLanguage()).toBe("ENGLISH");
  });

  it("picks first supported non-English language from the list", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: { languages: ["fr-FR", "de-CH", "en-US"], language: "fr-FR" },
      writable: true,
      configurable: true,
    });
    expect(detectBrowserLanguage()).toBe("GERMAN");
  });

  it("returns ENGLISH when navigator is undefined (SSR)", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    expect(detectBrowserLanguage()).toBe("ENGLISH");
  });
});

// ─── resolveLanguage ────────────────────────────────────────────────

describe("resolveLanguage", () => {
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  it("passes through ENGLISH unchanged", () => {
    expect(resolveLanguage("ENGLISH")).toBe("ENGLISH");
  });

  it("passes through GERMAN unchanged", () => {
    expect(resolveLanguage("GERMAN")).toBe("GERMAN");
  });

  it("resolves AUTOMATIC using browser detection", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: { languages: ["de-DE"], language: "de-DE" },
      writable: true,
      configurable: true,
    });
    expect(resolveLanguage("AUTOMATIC")).toBe("GERMAN");
  });

  it("resolves AUTOMATIC to ENGLISH when browser is English", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: { languages: ["en-US"], language: "en-US" },
      writable: true,
      configurable: true,
    });
    expect(resolveLanguage("AUTOMATIC")).toBe("ENGLISH");
  });
});

// ─── detectBrowserTimeFormat ────────────────────────────────────────

describe("detectBrowserTimeFormat", () => {
  it("returns a valid time format", () => {
    const result = detectBrowserTimeFormat();
    expect(["TWELVE_HOUR", "TWENTY_FOUR_HOUR"]).toContain(result);
  });
});

// ─── resolveTimeFormat ──────────────────────────────────────────────

describe("resolveTimeFormat", () => {
  it("passes through TWELVE_HOUR unchanged", () => {
    expect(resolveTimeFormat("TWELVE_HOUR")).toBe("TWELVE_HOUR");
  });

  it("passes through TWENTY_FOUR_HOUR unchanged", () => {
    expect(resolveTimeFormat("TWENTY_FOUR_HOUR")).toBe("TWENTY_FOUR_HOUR");
  });

  it("resolves AUTOMATIC to a valid time format", () => {
    const result = resolveTimeFormat("AUTOMATIC");
    expect(["TWELVE_HOUR", "TWENTY_FOUR_HOUR"]).toContain(result);
  });
});

// ─── detectBrowserTimezone ──────────────────────────────────────────

describe("detectBrowserTimezone", () => {
  it("returns a non-empty IANA timezone string", () => {
    const tz = detectBrowserTimezone();
    expect(typeof tz).toBe("string");
    expect(tz.length).toBeGreaterThan(0);
  });
});

// ─── resolveTimezone ────────────────────────────────────────────────

describe("resolveTimezone", () => {
  it("passes through a specific timezone unchanged", () => {
    expect(resolveTimezone("Europe/Berlin")).toBe("Europe/Berlin");
  });

  it("passes through UTC unchanged", () => {
    expect(resolveTimezone("UTC")).toBe("UTC");
  });

  it("resolves AUTOMATIC to an IANA timezone", () => {
    const tz = resolveTimezone(AUTOMATIC_TIMEZONE);
    expect(typeof tz).toBe("string");
    expect(tz).not.toBe("AUTOMATIC");
    expect(tz.length).toBeGreaterThan(0);
  });
});

// ─── language cookie ────────────────────────────────────────────────

describe("language cookie", () => {
  let cookieStore: string;

  beforeEach(() => {
    cookieStore = "";
    Object.defineProperty(globalThis, "document", {
      value: {
        get cookie() {
          return cookieStore;
        },
        set cookie(v: string) {
          const [pair] = v.split(";");
          const [name, val] = (pair ?? "").split("=");
          if (!name) return;
          const isDelete = v.includes("max-age=0");
          const entries = cookieStore
            .split("; ")
            .filter((e) => e && !e.startsWith(`${name}=`));
          if (!isDelete && val) entries.push(`${name}=${val}`);
          cookieStore = entries.join("; ");
        },
      },
      writable: true,
      configurable: true,
    });
  });

  it("returns null when no cookie is set", () => {
    expect(getLanguageOverride()).toBeNull();
  });

  it("persists and reads AUTOMATIC", () => {
    setLanguageOverride("AUTOMATIC");
    expect(getLanguageOverride()).toBe("AUTOMATIC");
  });

  it("persists and reads ENGLISH", () => {
    setLanguageOverride("ENGLISH");
    expect(getLanguageOverride()).toBe("ENGLISH");
  });

  it("persists and reads GERMAN", () => {
    setLanguageOverride("GERMAN");
    expect(getLanguageOverride()).toBe("GERMAN");
  });

  it("ignores invalid cookie values", () => {
    document.cookie = "classifyre-language=FRENCH; path=/";
    expect(getLanguageOverride()).toBeNull();
  });

  it("clearLanguageOverride removes the cookie", () => {
    setLanguageOverride("GERMAN");
    expect(getLanguageOverride()).toBe("GERMAN");
    clearLanguageOverride();
    expect(getLanguageOverride()).toBeNull();
  });
});

// ─── URL locale prefixes ────────────────────────────────────────────

describe("locale ↔ language", () => {
  it("round-trips every locale", () => {
    for (const locale of LOCALES) {
      expect(languageToLocale(localeToLanguage(locale))).toBe(locale);
    }
  });

  it("recognises exactly the supported locales", () => {
    expect(LOCALES.every(isLocale)).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale("EN")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it("carries a tag for every locale", () => {
    for (const locale of LOCALES) {
      expect(localeHtmlLang(locale)).toBeTruthy();
      expect(localeOpenGraph(locale)).toMatch(/^[a-z]{2}_[A-Z]{2}$/);
    }
  });
});

describe("localePathPrefix", () => {
  it("leaves the default locale unprefixed", () => {
    expect(localePathPrefix(DEFAULT_LOCALE)).toBe("");
    expect(localePathPrefix("de")).toBe("/de");
  });
});

describe("stripLocalePrefix / withLocalePrefix", () => {
  it("treats an unprefixed path as the default locale", () => {
    expect(stripLocalePrefix("/acme/findings")).toEqual({
      locale: DEFAULT_LOCALE,
      rest: "/acme/findings",
    });
    expect(stripLocalePrefix("/")).toEqual({
      locale: DEFAULT_LOCALE,
      rest: "/",
    });
  });

  it("splits a locale prefix off", () => {
    expect(stripLocalePrefix("/de/acme/findings")).toEqual({
      locale: "de",
      rest: "/acme/findings",
    });
    expect(stripLocalePrefix("/de")).toEqual({ locale: "de", rest: "/" });
  });

  it("does not mistake a namespace that merely starts with a locale", () => {
    // `en` and `de` are reserved slugs, but `england` and `dev` are not.
    expect(stripLocalePrefix("/england/findings")).toEqual({
      locale: DEFAULT_LOCALE,
      rest: "/england/findings",
    });
    expect(stripLocalePrefix("/dev/findings")).toEqual({
      locale: DEFAULT_LOCALE,
      rest: "/dev/findings",
    });
  });

  it("replaces an existing prefix rather than doubling it", () => {
    expect(withLocalePrefix("de", "/de/acme")).toBe("/de/acme");
    expect(withLocalePrefix("en", "/de/acme")).toBe("/acme");
    expect(withLocalePrefix("de", "/acme")).toBe("/de/acme");
    expect(withLocalePrefix("de", "/")).toBe("/de");
    expect(withLocalePrefix("en", "/")).toBe("/");
  });

  it("round-trips every locale through both directions", () => {
    for (const locale of LOCALES) {
      const prefixed = withLocalePrefix(locale, "/acme/findings");
      expect(stripLocalePrefix(prefixed)).toEqual({
        locale,
        rest: "/acme/findings",
      });
    }
  });
});

describe("next.config.mjs locale table", () => {
  // The Next CLI loads next.config.mjs before any TypeScript path alias
  // exists, so it re-declares the locale list. Pin the copies together.
  const config = fs.readFileSync(
    path.join(__dirname, "..", "next.config.mjs"),
    "utf8",
  );

  it("lists the same locales as this module", () => {
    const match = /const LOCALES = \[([^\]]*)\];/.exec(config);
    expect(match).not.toBeNull();
    const configured = (match?.[1] ?? "")
      .split(",")
      .map((value) => value.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
    expect(configured).toEqual([...LOCALES]);
  });

  it("uses the same default locale", () => {
    expect(config).toContain(`const DEFAULT_LOCALE = "${DEFAULT_LOCALE}";`);
  });
});

// ─── Language switcher target ───────────────────────────────────────

describe("localeSwitchHref", () => {
  it("swaps the prefix on the page the user is looking at", () => {
    expect(localeSwitchHref("/acme/findings", "GERMAN")).toBe(
      "/de/acme/findings",
    );
    expect(localeSwitchHref("/de/acme/findings", "ENGLISH")).toBe(
      "/acme/findings",
    );
  });

  it("is idempotent for the language already in the URL", () => {
    expect(localeSwitchHref("/de/acme", "GERMAN")).toBe("/de/acme");
    expect(localeSwitchHref("/acme", "ENGLISH")).toBe("/acme");
  });

  it("keeps the query string and hash", () => {
    expect(
      localeSwitchHref("/acme/findings", "GERMAN", "?severity=high#f-1"),
    ).toBe("/de/acme/findings?severity=high#f-1");
  });

  it("handles the workspace directory at the root", () => {
    expect(localeSwitchHref("/", "GERMAN")).toBe("/de");
    expect(localeSwitchHref("/de", "ENGLISH")).toBe("/");
  });
});
