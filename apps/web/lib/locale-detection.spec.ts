import {
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
