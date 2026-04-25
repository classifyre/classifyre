import { SearchFindingsFiltersInputDtoDetectorTypeEnum } from "@workspace/api-client";

export const detectorUiGroups = [
  {
    id: "secrets_credentials",
    label: "Secrets & Credentials",
    description:
      "Credential leaks, code issues, and high-risk security signals.",
  },
  {
    id: "privacy_pii",
    label: "Privacy & PII",
    description:
      "Personal data detection across global and regional PII entity types.",
  },
  {
    id: "threats_attacks",
    label: "Threats & Attacks",
    description:
      "Active threat indicators such as prompt injection attacks.",
  },
  {
    id: "harmful_content",
    label: "Harmful Content",
    description:
      "Toxicity and NSFW content checks.",
  },
  {
    id: "content_quality",
    label: "Content Quality",
    description:
      "Spam, broken links, and language quality signals.",
  },
  {
    id: "classification",
    label: "Classification & Tagging",
    description:
      "Custom detector results and classification-style findings.",
  },
] as const;

export type DetectorUiGroupId = (typeof detectorUiGroups)[number]["id"];

type DetectorTypeEnumValue =
  (typeof SearchFindingsFiltersInputDtoDetectorTypeEnum)[keyof typeof SearchFindingsFiltersInputDtoDetectorTypeEnum];

const groupByDetectorTypeEntries = [
  [SearchFindingsFiltersInputDtoDetectorTypeEnum.Secrets, "secrets_credentials"],
  [SearchFindingsFiltersInputDtoDetectorTypeEnum.CodeSecurity, "secrets_credentials"],
  [SearchFindingsFiltersInputDtoDetectorTypeEnum.Pii, "privacy_pii"],
  [SearchFindingsFiltersInputDtoDetectorTypeEnum.Yara, "threats_attacks"],
  [SearchFindingsFiltersInputDtoDetectorTypeEnum.PromptInjection, "threats_attacks"],
  [SearchFindingsFiltersInputDtoDetectorTypeEnum.Toxic, "harmful_content"],
  [SearchFindingsFiltersInputDtoDetectorTypeEnum.Nsfw, "harmful_content"],
  [SearchFindingsFiltersInputDtoDetectorTypeEnum.Spam, "content_quality"],
  [SearchFindingsFiltersInputDtoDetectorTypeEnum.Language, "content_quality"],
  [SearchFindingsFiltersInputDtoDetectorTypeEnum.BrokenLinks, "content_quality"],
  [SearchFindingsFiltersInputDtoDetectorTypeEnum.Custom, "classification"],
] as const satisfies readonly (readonly [
  DetectorTypeEnumValue,
  DetectorUiGroupId,
])[];

const groupByDetectorType = new Map<DetectorTypeEnumValue, DetectorUiGroupId>(
  groupByDetectorTypeEntries,
);

const detectorAiExamplesByGroup = {
  secrets_credentials: [
    "Use strict settings for production credentials and source code leaks.",
    "Reduce noise for internal docs but keep high-confidence secret findings.",
    "Tune for CI logs with fewer false positives.",
  ],
  privacy_pii: [
    "Use strict privacy checks for EU customer support transcripts.",
    "Focus on contact info and identity numbers with high confidence.",
    "Use broad PII coverage for compliance review before publishing.",
  ],
  threats_attacks: [
    "Harden prompt injection detection for external content.",
    "Use balanced threat detection with medium confidence.",
    "Prioritize critical threat findings and keep output concise.",
  ],
  harmful_content: [
    "Use strict moderation for public community content.",
    "Detect severe toxicity and hate speech with high confidence.",
    "Optimize for safety-first filtering in customer-facing channels.",
  ],
  content_quality: [
    "Highlight low-quality and duplicate pages for editorial cleanup.",
    "Focus on spam and duplicate detection with medium sensitivity.",
    "Tune for quality assurance in SEO content workflows.",
  ],
  classification: [
    "Classify content by domain and sensitivity for governance routing.",
    "Tag text for policy and jurisdiction reporting with stable defaults.",
    "Prefer conservative labels and high-confidence classifications.",
  ],
} as const satisfies Record<DetectorUiGroupId, readonly string[]>;

function resolveGroupByCategories(
  categories: readonly string[],
): DetectorUiGroupId {
  const normalized = new Set(
    categories.map((category) => category.toUpperCase()),
  );
  if (normalized.has("CLASSIFICATION")) return "classification";
  if (normalized.has("PRIVACY")) return "privacy_pii";
  if (normalized.has("THREAT")) return "threats_attacks";
  if (normalized.has("SECURITY")) return "secrets_credentials";
  if (normalized.has("CONTENT")) return "harmful_content";
  return "content_quality";
}

export function getDetectorGroupId(
  detectorType: string,
  categories: readonly string[],
): DetectorUiGroupId {
  const mapped = groupByDetectorType.get(detectorType as DetectorTypeEnumValue);
  if (mapped) {
    return mapped;
  }
  return resolveGroupByCategories(categories);
}

export function getDetectorAiExamples(
  detectorType: string,
  categories: readonly string[],
): readonly string[] {
  const groupId = getDetectorGroupId(detectorType, categories);
  return detectorAiExamplesByGroup[groupId];
}
