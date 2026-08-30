import {
  detectorTypeIconName,
  detectorTypeTranslationKey,
  isTagDetector,
  TAG_PIPELINE_TYPE,
} from "./custom-detector-badge";

describe("isTagDetector", () => {
  it("recognises a tag detector", () => {
    expect(isTagDetector({ pipelineSchema: { type: "TAG" } })).toBe(true);
  });

  it("is case-insensitive on the discriminator", () => {
    expect(isTagDetector({ pipelineSchema: { type: "tag" } })).toBe(true);
  });

  it.each([
    [{ pipelineSchema: { type: "REGEX" } }],
    [{ pipelineSchema: { type: "LLM" } }],
    [{ pipelineSchema: {} }],
    [{}],
    [null],
    [undefined],
  ])("rejects %p", (detector) => {
    expect(isTagDetector(detector)).toBe(false);
  });
});

describe("tag detector presentation", () => {
  it("uses the tag icon", () => {
    expect(detectorTypeIconName(null, TAG_PIPELINE_TYPE)).toBe("Tag");
  });

  it("resolves to the tag translation key", () => {
    expect(detectorTypeTranslationKey(null, TAG_PIPELINE_TYPE)).toBe(
      "detectors.types.tag.title",
    );
  });
});
