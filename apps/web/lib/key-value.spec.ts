import {
  keyValueEntriesAreValid,
  secretEntriesToPatch,
  validateKey,
} from "./key-value";

describe("validateKey", () => {
  it.each([
    ["api_base", null],
    ["_private", null],
    ["a", null],
    ["", "empty"],
    ["   ", "empty"],
    // A hyphen is not valid in a Python identifier, so ctx.var("api-token")
    // could never reach it.
    ["api-token", "invalid"],
    ["2fa", "invalid"],
    ["has space", "invalid"],
    ["dotted.key", "invalid"],
  ])("classifies %p as %p", (key, expected) => {
    expect(validateKey(key, [key])).toBe(expected);
  });

  it("flags a key used twice", () => {
    expect(validateKey("same", ["same", "same"])).toBe("duplicate");
  });
});

describe("keyValueEntriesAreValid", () => {
  it("accepts distinct identifier keys", () => {
    expect(
      keyValueEntriesAreValid([
        { key: "api_base", value: "1" },
        { key: "token", value: "2" },
      ]),
    ).toBe(true);
  });

  it("rejects duplicates and bad characters", () => {
    expect(
      keyValueEntriesAreValid([
        { key: "same", value: "1" },
        { key: "same", value: "2" },
      ]),
    ).toBe(false);
    expect(keyValueEntriesAreValid([{ key: "2fa", value: "1" }])).toBe(false);
    expect(keyValueEntriesAreValid([{ key: "", value: "1" }])).toBe(false);
  });
});

describe("secretEntriesToPatch", () => {
  it("touches only what changed", () => {
    // The editor is never sent secret values, so an untouched entry must be
    // left alone rather than overwritten with the blank the form holds.
    const patch = secretEntriesToPatch(
      [
        { key: "kept", value: "", existing: true },
        { key: "changed", value: "new-value", existing: false },
        { key: "added", value: "fresh", existing: false },
      ],
      ["kept", "changed", "removed"],
    );

    expect(patch).toEqual({
      changed: "new-value",
      added: "fresh",
      removed: null,
    });
    expect(patch).not.toHaveProperty("kept");
  });

  it("deletes a secret the user removed from the list", () => {
    expect(secretEntriesToPatch([], ["gone"])).toEqual({ gone: null });
  });

  it("is empty when nothing was touched", () => {
    expect(
      secretEntriesToPatch(
        [{ key: "kept", value: "", existing: true }],
        ["kept"],
      ),
    ).toEqual({});
  });

  it("ignores blank keys", () => {
    expect(secretEntriesToPatch([{ key: "  ", value: "x" }], [])).toEqual({});
  });
});
