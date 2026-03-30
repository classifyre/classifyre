"""Shared detector config resolution and type mapping."""

from __future__ import annotations

from typing import Any

from ..models.generated_detectors import (
    BiasDetectorConfig,
    BrokenLinksDetectorConfig,
    ClassificationDetectorConfig,
    ContentDetectorConfig,
    ContentQualityDetectorConfig,
    CustomDetectorConfig,
    DeidScoreDetectorConfig,
    DetectorConfig,
    PIIDetectorConfig,
    SecretsDetectorConfig,
    ThreatDetectorConfig,
)

type DetectorTypedConfig = (
    DetectorConfig
    | ContentDetectorConfig
    | ContentQualityDetectorConfig
    | ClassificationDetectorConfig
    | DeidScoreDetectorConfig
    | BiasDetectorConfig
    | CustomDetectorConfig
    | SecretsDetectorConfig
    | PIIDetectorConfig
    | ThreatDetectorConfig
    | BrokenLinksDetectorConfig
)

_DETECTOR_NAME_BY_TYPE: dict[str, str] = {
    "SECRETS": "secrets",
    "PII": "pii",
    "TOXIC": "toxic",
    "NSFW": "nsfw",
    "YARA": "yara",
    "BROKEN_LINKS": "broken_links",
    "PROMPT_INJECTION": "prompt_injection",
    "PHISHING_URL": "phishing_url",
    "SPAM": "spam",
    "LANGUAGE": "language",
    "CODE_SECURITY": "code_security",
    "PLAGIARISM": "plagiarism",
    "IMAGE_VIOLENCE": "image_violence",
    "OCR_PII": "ocr_pii",
    "DEID_SCORE": "deid_score",
    "HATE_SPEECH": "hate_speech",
    "AI_GENERATED": "ai_generated",
    "CONTENT_QUALITY": "content_quality",
    "BIAS": "bias",
    "DUPLICATE": "duplicate",
    "DOMAIN_CLASS": "domain_class",
    "CONTENT_TYPE": "content_type",
    "SENSITIVITY_TIER": "sensitivity_tier",
    "JURISDICTION_TAG": "jurisdiction_tag",
    "CUSTOM": "custom",
}

_DETECTOR_CONFIG_BY_TYPE: dict[str, type[DetectorConfig]] = {
    "TOXIC": ContentDetectorConfig,
    "NSFW": ContentDetectorConfig,
    "SECRETS": SecretsDetectorConfig,
    "PII": PIIDetectorConfig,
    "OCR_PII": PIIDetectorConfig,
    "DEID_SCORE": DeidScoreDetectorConfig,
    "CONTENT_QUALITY": ContentQualityDetectorConfig,
    "DOMAIN_CLASS": ClassificationDetectorConfig,
    "CONTENT_TYPE": ClassificationDetectorConfig,
    "SENSITIVITY_TIER": ClassificationDetectorConfig,
    "JURISDICTION_TAG": ClassificationDetectorConfig,
    "BIAS": BiasDetectorConfig,
    "YARA": ThreatDetectorConfig,
    "BROKEN_LINKS": BrokenLinksDetectorConfig,
    "CUSTOM": CustomDetectorConfig,
}


def normalize_detector_type(detector_type: str) -> str:
    return detector_type.strip().upper()


def get_detector_name(detector_type: str) -> str:
    normalized = normalize_detector_type(detector_type)
    return _DETECTOR_NAME_BY_TYPE.get(normalized, normalized.lower())


def parse_detector_config(detector_type: str, raw_config: Any) -> tuple[str, DetectorTypedConfig]:
    normalized = normalize_detector_type(detector_type)
    detector_name = get_detector_name(normalized)
    config_cls = _DETECTOR_CONFIG_BY_TYPE.get(normalized, DetectorConfig)
    if not isinstance(raw_config, dict):
        raw_config = {}
    typed_config = config_cls.model_validate(raw_config)
    return detector_name, typed_config
