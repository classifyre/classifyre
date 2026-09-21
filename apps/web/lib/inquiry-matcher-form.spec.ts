import {
  ALL_SOURCES_VALUE,
  customDetectorValue,
  detectorOptionCount,
  detectorValuesFromMatchers,
  isFindingTypeCovered,
  matchersFromDetectorValues,
  matchersFromSourceValues,
  normaliseSourceValues,
  pruneFindingTypes,
  sourceValuesFromMatchers,
  visibleFindingTypes,
  type MatcherCustomDetectorOption,
  type MatcherFindingTypeOption,
} from "./inquiry-matcher-form";

const TYPES: MatcherFindingTypeOption[] = [
  { value: "ssn", detectorType: "PII", count: 10 },
  { value: "email", detectorType: "PII", count: 5 },
  { value: "aws_key", detectorType: "SECRETS", count: 3 },
  { value: "tag:Shell risk", detectorType: "CUSTOM", count: 7 },
];

const CUSTOMS: MatcherCustomDetectorOption[] = [
  { key: "shell", name: "Shell risk", openFindings: 7 },
];

const CUSTOM_TYPES: MatcherFindingTypeOption[] = [
  { value: "tag:Shell risk", detectorType: "CUSTOM", count: 7 },
  { value: "insolvenzgefahr_hoch", detectorType: "CUSTOM", count: 42 },
  { value: "stabil", detectorType: "CUSTOM", count: 83 },
];

const CUSTOMS_WITH_TYPES: MatcherCustomDetectorOption[] = [
  {
    key: "shell",
    name: "Shell risk",
    openFindings: 7,
    findingTypes: ["tag:Shell risk"],
  },
  {
    key: "solvency",
    name: "Solvency outlook",
    openFindings: 125,
    findingTypes: ["insolvenzgefahr_hoch", "stabil"],
  },
];

describe("source All toggle", () => {
  it("starts on All when matchers match everything", () => {
    expect(sourceValuesFromMatchers(true, [])).toEqual([ALL_SOURCES_VALUE]);
  });

  it("normalises a legacy empty specific selection to All", () => {
    expect(sourceValuesFromMatchers(false, [])).toEqual([ALL_SOURCES_VALUE]);
  });

  it("keeps specific ids", () => {
    expect(sourceValuesFromMatchers(false, ["s1", "s2"])).toEqual([
      "s1",
      "s2",
    ]);
  });

  it("picking a specific source while All is selected drops All", () => {
    expect(
      normaliseSourceValues([ALL_SOURCES_VALUE, "s1"], [ALL_SOURCES_VALUE]),
    ).toEqual(["s1"]);
  });

  it("picking All while specifics are selected clears them", () => {
    expect(
      normaliseSourceValues(["s1", "s2", ALL_SOURCES_VALUE], ["s1", "s2"]),
    ).toEqual([ALL_SOURCES_VALUE]);
  });

  it("deselecting All on its own stays on All instead of going empty", () => {
    expect(normaliseSourceValues([], [ALL_SOURCES_VALUE])).toEqual([
      ALL_SOURCES_VALUE,
    ]);
  });

  it("deselecting the last specific source falls back to All", () => {
    expect(normaliseSourceValues([], ["s1"])).toEqual([ALL_SOURCES_VALUE]);
  });

  it("maps All back to match-all matchers", () => {
    expect(matchersFromSourceValues([ALL_SOURCES_VALUE])).toEqual({
      matchAllSources: true,
      sourceIds: [],
    });
    expect(matchersFromSourceValues(["s1"])).toEqual({
      matchAllSources: false,
      sourceIds: ["s1"],
    });
  });
});

describe("merged detector select", () => {
  it("merges built-ins and custom keys, never CUSTOM", () => {
    expect(
      detectorValuesFromMatchers(["PII", "CUSTOM"], ["shell"], ["shell"]),
    ).toEqual(["PII", customDetectorValue("shell")]);
  });

  it("expands a legacy bare CUSTOM to every known custom detector", () => {
    expect(detectorValuesFromMatchers(["CUSTOM"], [], ["a", "b"])).toEqual([
      customDetectorValue("a"),
      customDetectorValue("b"),
    ]);
  });

  it("keeps unknown custom keys so saving does not lose them", () => {
    expect(detectorValuesFromMatchers([], ["gone"], ["shell"])).toEqual([
      customDetectorValue("gone"),
    ]);
  });

  it("splits values back without ever emitting CUSTOM", () => {
    expect(
      matchersFromDetectorValues(["PII", customDetectorValue("shell")]),
    ).toEqual({ detectorTypes: ["PII"], customDetectorKeys: ["shell"] });
    expect(matchersFromDetectorValues([])).toEqual({
      detectorTypes: [],
      customDetectorKeys: [],
    });
  });

  it("counts built-ins from type rows and customs from detector totals", () => {
    expect(detectorOptionCount("PII", TYPES, CUSTOMS)).toBe(15);
    expect(detectorOptionCount("SECRETS", TYPES, CUSTOMS)).toBe(3);
    expect(
      detectorOptionCount(customDetectorValue("shell"), TYPES, CUSTOMS),
    ).toBe(7);
    expect(
      detectorOptionCount(customDetectorValue("missing"), TYPES, CUSTOMS),
    ).toBe(0);
  });
});

describe("finding types filtered by detectors", () => {
  it("shows everything when no detector is selected", () => {
    expect(visibleFindingTypes(TYPES, [], [], "").map((t) => t.value)).toEqual([
      "ssn",
      "email",
      "aws_key",
      "tag:Shell risk",
    ]);
  });

  it("filters rows to the selected detectors", () => {
    expect(
      visibleFindingTypes(TYPES, ["PII"], [], "").map((t) => t.value),
    ).toEqual(["ssn", "email"]);
  });

  it("covers CUSTOM rows when any custom detector is selected", () => {
    expect(
      visibleFindingTypes(TYPES, [], ["shell"], "").map((t) => t.value),
    ).toEqual(["tag:Shell risk"]);
    expect(visibleFindingTypes(TYPES, ["PII"], [], "").map((t) => t.value)).not.toContain(
      "tag:Shell risk",
    );
  });

  it("narrows CUSTOM rows to the selected detectors' own emitted types", () => {
    expect(
      visibleFindingTypes(CUSTOM_TYPES, [], ["shell"], "", CUSTOMS_WITH_TYPES).map(
        (t) => t.value,
      ),
    ).toEqual(["tag:Shell risk"]);
    expect(
      visibleFindingTypes(
        CUSTOM_TYPES,
        [],
        ["shell", "solvency"],
        "",
        CUSTOMS_WITH_TYPES,
      ).map((t) => t.value),
    ).toEqual(["tag:Shell risk", "insolvenzgefahr_hoch", "stabil"]);
  });

  it("keeps all CUSTOM rows when only orphan keys are selected", () => {
    expect(
      visibleFindingTypes(CUSTOM_TYPES, [], ["gone"], "", CUSTOMS_WITH_TYPES).map(
        (t) => t.value,
      ),
    ).toEqual(["tag:Shell risk", "insolvenzgefahr_hoch", "stabil"]);
  });

  it("keeps all CUSTOM rows when no selected detector reports types", () => {
    const quiet: MatcherCustomDetectorOption[] = [
      { key: "quiet", name: "Quiet", openFindings: 0, findingTypes: [] },
    ];
    expect(
      visibleFindingTypes(CUSTOM_TYPES, [], ["quiet"], "", quiet).map(
        (t) => t.value,
      ),
    ).toEqual(["tag:Shell risk", "insolvenzgefahr_hoch", "stabil"]);
  });

  it("applies the search on top of the detector filter", () => {
    expect(
      visibleFindingTypes(TYPES, [], [], "ss").map((t) => t.value),
    ).toEqual(["ssn"]);
  });

  // The core challenge: pick types under one detector selection, change the
  // selection, and the now-uncovered types must be deselected.
  it("prunes types the new detector selection no longer covers", () => {
    expect(pruneFindingTypes(["ssn", "email"], TYPES, ["PII"], [])).toEqual([
      "ssn",
      "email",
    ]);
    expect(pruneFindingTypes(["ssn", "aws_key"], TYPES, ["PII"], [])).toEqual([
      "ssn",
    ]);
  });

  it("prunes CUSTOM types once no custom detector is selected", () => {
    expect(
      pruneFindingTypes(["tag:Shell risk"], TYPES, ["PII"], []),
    ).toEqual([]);
    expect(
      pruneFindingTypes(["tag:Shell risk"], TYPES, [], ["shell"]),
    ).toEqual(["tag:Shell risk"]);
  });

  it("prunes CUSTOM types the selected detector does not emit", () => {
    expect(
      pruneFindingTypes(
        ["tag:Shell risk", "stabil"],
        CUSTOM_TYPES,
        [],
        ["shell"],
        CUSTOMS_WITH_TYPES,
      ),
    ).toEqual(["tag:Shell risk"]);
  });

  it("keeps selected types match-options cannot see", () => {
    expect(
      pruneFindingTypes(["legacy:type"], TYPES, ["SECRETS"], []),
    ).toEqual(["legacy:type"]);
  });

  it("prunes nothing when the detector filter is empty", () => {
    expect(
      pruneFindingTypes(["ssn", "aws_key", "tag:Shell risk"], TYPES, [], []),
    ).toEqual(["ssn", "aws_key", "tag:Shell risk"]);
  });

  it("isFindingTypeCovered treats empty selection as any", () => {
    expect(
      isFindingTypeCovered(
        { value: "ssn", detectorType: "PII" },
        { detectorTypes: [], customDetectorKeys: [], customDetectors: [] },
      ),
    ).toBe(true);
    expect(
      isFindingTypeCovered(
        { value: "tag:Shell risk", detectorType: "CUSTOM" },
        { detectorTypes: [], customDetectorKeys: [], customDetectors: [] },
      ),
    ).toBe(true);
  });
});
