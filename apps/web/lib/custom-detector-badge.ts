export type DetectorCatalogStatus = "ACTIVE" | "INACTIVE";
export type DetectorTrainingStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED";

export type PipelineSubtype =
  | "REGEX"
  | "GLINER2"
  | "LLM"
  | "TEXT_CLASSIFICATION"
  | "IMAGE_CLASSIFICATION"
  | "FEATURE_EXTRACTION"
  | "OBJECT_DETECTION";

export type DetectorMethod = "RULESET" | "CLASSIFIER" | "ENTITY";

export function detectorCatalogStatusLabel(
  isActive: boolean,
): DetectorCatalogStatus {
  return isActive ? "ACTIVE" : "INACTIVE";
}

export function detectorCatalogStatusToRunnerStatus(isActive: boolean) {
  return isActive ? "COMPLETED" : "PENDING";
}

export function detectorTrainingStatusToRunnerStatus(status?: string | null) {
  const normalized = (status ?? "").toUpperCase();
  switch (normalized) {
    case "RUNNING":
      return "RUNNING";
    case "SUCCEEDED":
      return "COMPLETED";
    case "FAILED":
      return "ERROR";
    case "PENDING":
    default:
      return "PENDING";
  }
}

export function detectorTypeTranslationKey(
  method?: string | null,
  pipelineType?: string | null,
): string {
  const normalizedMethod = method?.toUpperCase();

  if (normalizedMethod === "RULESET") return "detectors.methods.rulesets";
  if (normalizedMethod === "CLASSIFIER") return "detectors.methods.classifiers";
  if (normalizedMethod === "ENTITY") return "detectors.methods.entity";

  if (pipelineType) {
    const normalized = pipelineType.toLowerCase();
    return `detectors.types.${normalized}.title`;
  }

  if (
    normalizedMethod === "SECRETS" ||
    normalizedMethod === "PII" ||
    normalizedMethod === "YARA" ||
    normalizedMethod === "BROKEN_LINKS" ||
    normalizedMethod === "CODE_SECURITY"
  ) {
    return `detectors.builtIn.${normalizedMethod.toLowerCase()}`;
  }

  return "detectors.methods.custom";
}

/**
 * Whether a detector processes content visually (as images) rather than as text.
 * IMAGE_CLASSIFICATION and OBJECT_DETECTION are inherently visual; an LLM detector
 * is visual only when its provider is configured with vision (image/PDF) input.
 */
export function isVisualDetector(
  pipelineType?: string | null,
  supportsVision?: boolean | null,
): boolean {
  const normalized = pipelineType?.toUpperCase();
  if (normalized === "IMAGE_CLASSIFICATION" || normalized === "OBJECT_DETECTION") {
    return true;
  }
  if (normalized === "LLM" && supportsVision) {
    return true;
  }
  return false;
}

export function detectorTypeIconName(
  method?: string | null,
  pipelineType?: string | null,
): string {
  const normalizedMethod = method?.toUpperCase();

  if (normalizedMethod === "RULESET") return "Regex";
  if (normalizedMethod === "CLASSIFIER") return "Brain";
  if (normalizedMethod === "ENTITY") return "Layers";

  const normalizedPipeline = pipelineType?.toUpperCase();
  if (normalizedPipeline === "REGEX") return "Regex";
  if (normalizedPipeline === "GLINER2") return "Layers";
  if (normalizedPipeline === "LLM") return "Bot";
  if (normalizedPipeline === "TEXT_CLASSIFICATION") return "Brain";
  if (normalizedPipeline === "IMAGE_CLASSIFICATION") return "Image";
  if (normalizedPipeline === "FEATURE_EXTRACTION") return "Network";
  if (normalizedPipeline === "OBJECT_DETECTION") return "ScanSearch";

  if (normalizedMethod === "SECRETS" || normalizedMethod === "CODE_SECURITY") return "Shield";
  if (normalizedMethod === "PII") return "Shield";
  if (normalizedMethod === "YARA") return "ShieldAlert";
  if (normalizedMethod === "BROKEN_LINKS") return "Link2";

  return "Sparkles";
}
