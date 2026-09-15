import {
  isNonTrainableKind,
  resolveDetectorKind,
} from "./detector-kind";

describe("resolveDetectorKind", () => {
  it("resolves a TAG detector to the tag editor, not GLiNER2", () => {
    expect(resolveDetectorKind({ type: "TAG" })).toBe("tag");
  });

  it("is case-insensitive on the pipeline discriminator", () => {
    expect(resolveDetectorKind({ type: "tag" })).toBe("tag");
    expect(resolveDetectorKind({ type: "regex" })).toBe("regex");
    expect(resolveDetectorKind({ type: "llm" })).toBe("llm");
    expect(resolveDetectorKind({ type: "Gliner2" })).toBe("gliner2");
  });

  it.each([
    [{ type: "REGEX" }, "regex"],
    [{ type: "LLM" }, "llm"],
    [{ type: "GLINER2" }, "gliner2"],
    [{ type: "TEXT_CLASSIFICATION" }, "transformer"],
    [{ type: "IMAGE_CLASSIFICATION" }, "transformer"],
    [{ type: "OBJECT_DETECTION" }, "transformer"],
  ])("resolves %p to %s", (schema, expected) => {
    expect(resolveDetectorKind(schema)).toBe(expected);
  });

  it.each([[{}], [null], [undefined]])(
    "falls back to the legacy editor for %p",
    (schema) => {
      expect(resolveDetectorKind(schema)).toBe("legacy");
    },
  );

  it("keeps the historical GLiNER2 fallthrough for an unrecognised schema", () => {
    expect(resolveDetectorKind({ entities: {} })).toBe("gliner2");
  });
});

describe("isNonTrainableKind", () => {
  it("treats tag detectors as non-trainable", () => {
    expect(isNonTrainableKind("tag")).toBe(true);
  });

  it.each(["regex", "llm", "transformer"] as const)(
    "treats %s as non-trainable",
    (kind) => {
      expect(isNonTrainableKind(kind)).toBe(true);
    },
  );

  it.each(["gliner2", "legacy"] as const)(
    "treats %s as trainable",
    (kind) => {
      expect(isNonTrainableKind(kind)).toBe(false);
    },
  );
});
