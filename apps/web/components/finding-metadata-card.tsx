"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Badge } from "@workspace/ui/components/badge";
import { FindingResponseDtoDetectorTypeEnum } from "@workspace/api-client";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

// Detector types that have interesting enough metadata to surface.
// Excludes CUSTOM (shown via FindingExtractionCard) and purely binary/noisy ones.
const DETECTORS_WITH_USEFUL_METADATA = new Set<string>([
  FindingResponseDtoDetectorTypeEnum.Pii,
  FindingResponseDtoDetectorTypeEnum.Secrets,
  FindingResponseDtoDetectorTypeEnum.CodeSecurity,
  FindingResponseDtoDetectorTypeEnum.Yara,
  FindingResponseDtoDetectorTypeEnum.Toxic,
  FindingResponseDtoDetectorTypeEnum.Language,
  FindingResponseDtoDetectorTypeEnum.Spam,
  FindingResponseDtoDetectorTypeEnum.PromptInjection,
  FindingResponseDtoDetectorTypeEnum.BrokenLinks,
]);

// Keys to always omit from the display (too internal / redundant with finding fields).
const OMIT_KEYS = new Set(["scores", "raw", "error"]);

// Maps raw metadata keys to their i18n translation keys under findings.metadata.*
const METADATA_KEY_TO_I18N: Record<string, TranslationKey> = {
  entity_type: "findings.metadata.entityType",
  recognizer: "findings.metadata.recognizer",
  detector: "findings.metadata.detectorPlugin",
  plugin: "findings.metadata.pluginClass",
  issue_text: "findings.metadata.issue",
  test_id: "findings.metadata.ruleId",
  test_name: "findings.metadata.ruleName",
  issue_severity: "findings.metadata.banditSeverity",
  issue_confidence: "findings.metadata.banditConfidence",
  rule_name: "findings.metadata.yaraRule",
  description: "findings.metadata.description",
  match_count: "findings.metadata.matchCount",
  model: "findings.metadata.model",
  predicted_label: "findings.metadata.predictedLabel",
  toxicity_type: "findings.metadata.toxicityType",
  language: "findings.metadata.language",
  tier: "findings.metadata.sensitivityTier",
  jurisdictions: "findings.metadata.jurisdictions",
  label: "findings.metadata.domainTypeLabel",
  hits: "findings.metadata.keywordHits",
  quality_score: "findings.metadata.qualityScore",
  avg_sentence_length: "findings.metadata.avgSentenceLength",
  long_word_ratio: "findings.metadata.longWordRatio",
  score: "findings.metadata.deidScore",
  risk_tier: "findings.metadata.riskTier",
  residual_pii_spans: "findings.metadata.residualPiiSpans",
  keyword_matches: "findings.metadata.keywordMatches",
  url_count: "findings.metadata.urlCount",
  exclamation_count: "findings.metadata.exclamationCount",
  status_code: "findings.metadata.httpStatus",
  reason: "findings.metadata.reason",
};

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "number") return String(Math.round(value * 1000) / 1000);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

type Props = {
  detectorType: string;
  metadata: Record<string, unknown> | null | undefined;
};

export function FindingMetadataCard({ detectorType, metadata }: Props) {
  const { t } = useTranslation();

  if (!DETECTORS_WITH_USEFUL_METADATA.has(detectorType)) return null;
  if (!metadata || typeof metadata !== "object") return null;

  const entries = Object.entries(metadata).filter(
    ([key, value]) =>
      !OMIT_KEYS.has(key) &&
      value !== null &&
      value !== undefined &&
      value !== "" &&
      !(Array.isArray(value) && value.length === 0),
  );

  if (entries.length === 0) return null;

  function formatKey(key: string): string {
    const i18nKey = METADATA_KEY_TO_I18N[key];
    if (i18nKey) return t(i18nKey);
    return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>{t("findings.signals.title")}</CardTitle>
            <CardDescription>{t("findings.signals.desc")}</CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-xs">
            {detectorType.replace(/_/g, " ")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-2">
          {entries.map(([key, value]) => (
            <div
              key={key}
              className="grid grid-cols-[200px_1fr] items-start gap-3 rounded-[4px] border border-black/10 px-3 py-2"
            >
              <dt className="text-xs font-medium text-muted-foreground pt-0.5">
                {formatKey(key)}
              </dt>
              <dd className="text-sm break-words">{renderValue(value)}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
