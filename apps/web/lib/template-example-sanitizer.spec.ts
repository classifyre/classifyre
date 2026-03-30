import allInputExamples from "../../../packages/schemas/src/schemas/all_input_examples.json";
import { sanitizeTemplateConfig } from "./template-example-sanitizer";

type SourceExample = {
  config: Record<string, unknown>;
};

const MASK_KEYS = ["masked", "mask", "masked_fields"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const collectDefinedLeaves = (
  value: unknown,
  path: string[] = [],
  acc: string[] = [],
): string[] => {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectDefinedLeaves(item, [...path, String(index)], acc),
    );
    return acc;
  }

  if (isRecord(value)) {
    Object.entries(value).forEach(([key, nested]) =>
      collectDefinedLeaves(nested, [...path, key], acc),
    );
    return acc;
  }

  if (value !== undefined) {
    acc.push(path.join("."));
  }

  return acc;
};

describe("sanitizeTemplateConfig", () => {
  const examplesByType = allInputExamples as Record<string, SourceExample[]>;
  const allExamples = Object.entries(examplesByType).flatMap(
    ([sourceType, examples]) =>
      examples.map((example, index) => ({ sourceType, example, index })),
  );

  it("covers all examples from schema json", () => {
    expect(allExamples.length).toBeGreaterThan(0);
  });

  it("sets every value under mask-like objects to undefined for every template", () => {
    for (const { sourceType, example, index } of allExamples) {
      const { type: _type, ...configData } = example.config;
      const sanitized = sanitizeTemplateConfig(configData);

      for (const maskKey of MASK_KEYS) {
        const originalMaskBlock = configData[maskKey];

        if (!isRecord(originalMaskBlock)) {
          continue;
        }

        expect(isRecord(sanitized[maskKey])).toBe(true);

        const nonUndefinedLeafPaths = collectDefinedLeaves(sanitized[maskKey]);
        expect(nonUndefinedLeafPaths).toEqual([]);

        expect(
          Object.keys(sanitized[maskKey] as Record<string, unknown>),
        ).toEqual(Object.keys(originalMaskBlock));
        if (nonUndefinedLeafPaths.length > 0) {
          throw new Error(
            `[${sourceType}] template #${index + 1} key "${maskKey}" has non-undefined leaves: ${nonUndefinedLeafPaths.join(
              ", ",
            )}`,
          );
        }
      }
    }
  });
});
