import { TAG_PIPELINE_TYPE } from "./custom-detector-badge";

/**
 * Single source of truth for "which editor / treatment does this detector
 * get?". Both the create flow and the edit flows (the `[id]` details page and
 * `DetectorEditorForm`) must resolve through here: the edit page once fell
 * through to the GLiNER2 editor for TAG detectors because it duplicated this
 * branching with a missing case.
 */
export const TRANSFORMER_PIPELINE_TYPES = [
  "TEXT_CLASSIFICATION",
  "IMAGE_CLASSIFICATION",
  "OBJECT_DETECTION",
] as const;

export type DetectorKind =
  | "regex"
  | "llm"
  | "tag"
  | "gliner2"
  | "transformer"
  | "legacy";

type SchemaLike = { type?: unknown } | null | undefined;

function normalizedType(
  pipelineSchema?: Record<string, unknown> | SchemaLike,
): string | undefined {
  const raw = (pipelineSchema as SchemaLike)?.type;
  return typeof raw === "string" ? raw.toUpperCase() : undefined;
}

export function isTransformerPipelineType(type?: string | null): boolean {
  const normalized = type?.toUpperCase();
  return (
    !!normalized &&
    (TRANSFORMER_PIPELINE_TYPES as readonly string[]).includes(normalized)
  );
}

export function resolveDetectorKind(
  pipelineSchema?: Record<string, unknown> | null,
  _method?: string | null,
): DetectorKind {
  const type = normalizedType(pipelineSchema);
  if (!type) {
    // A non-empty schema without a recognised discriminator keeps the
    // historical fallthrough to the GLiNER2 editor; only a missing or empty
    // schema means a legacy config/method detector.
    const hasKeys =
      !!pipelineSchema && Object.keys(pipelineSchema).length > 0;
    return hasKeys ? "gliner2" : "legacy";
  }
  if (isTransformerPipelineType(type)) return "transformer";
  if (type === "LLM") return "llm";
  if (type === TAG_PIPELINE_TYPE) return "tag";
  if (type === "REGEX") return "regex";
  // Any other pipeline schema is a GLiNER2-style pipeline detector.
  return "gliner2";
}

/** Detectors with no model-training step: nothing to train, no history. */
export function isNonTrainableKind(kind: DetectorKind): boolean {
  return (
    kind === "regex" ||
    kind === "llm" ||
    kind === "tag" ||
    kind === "transformer"
  );
}
