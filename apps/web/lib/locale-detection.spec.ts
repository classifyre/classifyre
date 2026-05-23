import {
  resolveLocaleTag,
  detectBrowserLanguage,
  resolveLanguage,
} from "./locale-detection";

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

describe("resolveLanguage", () => {
  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: globalThis.navigator,
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
