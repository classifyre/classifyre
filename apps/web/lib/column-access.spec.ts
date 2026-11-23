import { columnAccessFor, exposureOf } from "./column-access";

/**
 * The web's copy of the API's column rule
 * (apps/api/src/data-query/column-masks.ts, `effectiveColumnPolicy` and
 * `exposureOf`). The same cases as the API's spec, so the dialog's preview
 * and what the query job applies cannot drift apart unnoticed.
 */
describe("columnAccessFor", () => {
  it.each([
    [null, { action: "clear", fromClassification: true }],
    ["public", { action: "clear", fromClassification: true }],
    ["confidential", { action: "clear", fromClassification: true }],
    ["personal", { action: "mask", mask: "redact", fromClassification: true }],
    ["sensitive", { action: "mask", mask: "redact", fromClassification: true }],
    ["secret", { action: "hide", fromClassification: true }],
  ])("follows the classification %s when nobody set access", (c, want) => {
    expect(
      columnAccessFor({ access: null, maskKind: null, classification: c }),
    ).toEqual(want);
  });

  it("takes a steward's access over the classification", () => {
    expect(
      columnAccessFor({
        access: "clear",
        maskKind: null,
        classification: "secret",
      }),
    ).toEqual({ action: "clear", fromClassification: false });
    expect(
      columnAccessFor({
        access: "hide",
        maskKind: "hash",
        classification: null,
      }),
    ).toEqual({ action: "hide", fromClassification: false });
    expect(
      columnAccessFor({
        access: "mask",
        maskKind: "hash",
        classification: null,
      }),
    ).toEqual({ action: "mask", mask: "hash", fromClassification: false });
  });

  it("applies a mask kind to the default mask too", () => {
    expect(
      columnAccessFor({
        access: null,
        maskKind: "partial",
        classification: "personal",
      }),
    ).toEqual({ action: "mask", mask: "partial", fromClassification: true });
  });

  it("ignores values it does not know", () => {
    expect(
      columnAccessFor({
        access: "reveal",
        maskKind: "rot13",
        classification: "personal",
      }),
    ).toEqual({ action: "mask", mask: "redact", fromClassification: true });
  });
});

describe("exposureOf", () => {
  it("orders restricted, hidden, emptied or redacted, hashed, last four, scrubbed, clear", () => {
    const of = (
      action: "clear" | "mask" | "hide" | "restrict",
      mask?: string,
    ) =>
      exposureOf(
        columnAccessFor({
          access: action,
          maskKind: mask ?? null,
          classification: null,
        }),
      );
    const order = [
      of("restrict"),
      of("hide"),
      of("mask", "redact"),
      of("mask", "hash"),
      of("mask", "partial"),
      of("mask", "scrub"),
      of("clear"),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(new Set(order).size).toBe(order.length);
    expect(of("mask", "null")).toBe(of("mask", "redact"));
  });

  it("matches the API's numbers, so the preview and the server agree", () => {
    // apps/api/src/data-query/column-masks.ts
    expect(of2("restrict")).toBe(0);
    expect(of2("hide")).toBe(1);
    expect(of2("mask", "redact")).toBe(2);
    expect(of2("mask", "hash")).toBe(3);
    expect(of2("mask", "partial")).toBe(4);
    expect(of2("mask", "scrub")).toBe(5);
    expect(of2("clear")).toBe(6);
  });
});

function of2(action: "clear" | "mask" | "hide" | "restrict", mask?: string) {
  return exposureOf(
    columnAccessFor({
      access: action,
      maskKind: mask ?? null,
      classification: null,
    }),
  );
}
