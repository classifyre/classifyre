import { signInLocale } from "./sign-in-locale";

describe("sign-in language", () => {
  it("follows the page the person came from", () => {
    expect(signInLocale("/de/acme/findings")).toBe("de");
    expect(signInLocale("/de")).toBe("de");
    expect(signInLocale("/en/acme", "GERMAN")).toBe("en");
  });

  it("else the language chosen in the app", () => {
    expect(signInLocale("/acme/findings", "GERMAN")).toBe("de");
    expect(signInLocale("/", "ENGLISH")).toBe("en");
  });

  it("else leaves it to the identity server", () => {
    expect(signInLocale("/")).toBeNull();
    expect(signInLocale("/", "AUTOMATIC")).toBeNull();
    expect(signInLocale("/designs")).toBeNull();
  });
});
