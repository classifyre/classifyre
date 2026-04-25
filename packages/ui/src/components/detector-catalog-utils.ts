export type DetectorCatalogItem = {
  id: string;
  type: string;
  title: string;
  description?: string | null;
  categories: readonly string[];
  lifecycleStatus?: string | null;
  priority?: string | null;
  groupId: string;
  href?: string;
};

export type DetectorCatalogGroup = {
  id: string;
  label: string;
  description?: string;
};

const DETECTOR_TYPE_GROUP_MAP: Record<string, string> = {
  SECRETS: "secrets_credentials",
  CODE_SECURITY: "secrets_credentials",
  PII: "privacy_pii",
  YARA: "threats_attacks",
  PROMPT_INJECTION: "threats_attacks",
  PHISHING_URL: "threats_attacks",
  TOXIC: "harmful_content",
  NSFW: "harmful_content",
  SPAM: "content_quality",
  LANGUAGE: "content_quality",
  BROKEN_LINKS: "content_quality",
};

export const detectorCatalogGroups: readonly DetectorCatalogGroup[] = [
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
      "Personal data detection, OCR privacy, and de-identification checks.",
  },
  {
    id: "threats_attacks",
    label: "Threats & Attacks",
    description:
      "Active threat indicators such as prompt attacks and phishing URLs.",
  },
  {
    id: "harmful_content",
    label: "Harmful Content",
    description:
      "Toxicity, hate speech, NSFW, violence, and AI-generated content checks.",
  },
  {
    id: "content_quality",
    label: "Content Quality",
    description:
      "Spam, duplicates, plagiarism, readability, and language quality signals.",
  },
  {
    id: "classification",
    label: "Classification & Tagging",
    description:
      "Domain, content type, sensitivity tiers, and jurisdiction tagging.",
  },
];

export function resolveDetectorGroupId(
  type: string,
  categories: readonly string[],
): string {
  const mapped = DETECTOR_TYPE_GROUP_MAP[type.toUpperCase()];
  if (mapped) return mapped;

  const normalized = new Set(categories.map((c) => c.toUpperCase()));
  if (normalized.has("CLASSIFICATION")) return "classification";
  if (normalized.has("PRIVACY")) return "privacy_pii";
  if (normalized.has("THREAT")) return "threats_attacks";
  if (normalized.has("SECURITY")) return "secrets_credentials";
  if (normalized.has("CONTENT")) return "harmful_content";
  return "content_quality";
}
