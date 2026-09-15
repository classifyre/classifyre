import { preserveDetectorScope } from "./detector-scope";

describe("preserveDetectorScope", () => {
  const stored = {
    type: "REGEX",
    patterns: { EUID: { pattern: "x" } },
    scope: { asset_kinds: ["record", "document"] },
    budget: { max_consecutive_failures: 3 },
  };

  it("carries scope and budget through a form that does not render them", () => {
    const built = { type: "REGEX", patterns: { AT_FN: { pattern: "y" } } };

    expect(preserveDetectorScope(stored, built)).toEqual({
      ...built,
      scope: stored.scope,
      budget: stored.budget,
    });
  });

  it("lets a form that owns budget change it", () => {
    const built = { type: "LLM", budget: { max_attempts: 1 } };

    expect(preserveDetectorScope(stored, built).budget).toEqual({
      max_attempts: 1,
    });
  });

  it("lets a form clear budget with null instead of resurrecting the old one", () => {
    const built = { type: "LLM", budget: null };

    expect(preserveDetectorScope(stored, built).budget).toBeNull();
  });

  it("adds nothing when nothing was stored", () => {
    const built = { type: "TAG" };

    expect(preserveDetectorScope(undefined, built)).toBe(built);
    expect(preserveDetectorScope({ scope: null }, built)).toBe(built);
  });
});
