import { narrowsDetector } from "./detector-narrowing";

const regex = (
  kinds: string[] | undefined,
  patterns: string[],
): Record<string, unknown> => ({
  type: "REGEX",
  ...(kinds ? { scope: { asset_kinds: kinds } } : {}),
  patterns: Object.fromEntries(patterns.map((key) => [key, { pattern: "x" }])),
});

describe("narrowsDetector", () => {
  it("flags a kind dropped from the scope", () => {
    expect(
      narrowsDetector(
        regex(["record", "page"], ["FN"]),
        regex(["record"], ["FN"]),
      ),
    ).toBe(true);
  });

  it("flags scoping a detector that covered every kind", () => {
    expect(
      narrowsDetector(regex(undefined, ["FN"]), regex(["record"], ["FN"])),
    ).toBe(true);
  });

  it("flags a removed regex pattern and a switch away from REGEX", () => {
    expect(narrowsDetector(regex(undefined, ["FN", "EUID"]), regex(undefined, ["FN"]))).toBe(true);
    expect(
      narrowsDetector(regex(undefined, ["FN"]), { type: "LLM", labels: [] }),
    ).toBe(true);
  });

  it("ignores widening, case and whitespace, and unrelated edits", () => {
    expect(
      narrowsDetector(regex(["record"], ["FN"]), regex([" Record ", "page"], ["FN", "EUID"])),
    ).toBe(false);
    expect(narrowsDetector(regex(["record"], ["FN"]), regex([], ["FN"]))).toBe(
      false,
    );
    expect(
      narrowsDetector(
        { type: "LLM", labels: ["a"] },
        { type: "LLM", labels: ["b"] },
      ),
    ).toBe(false);
  });
});
