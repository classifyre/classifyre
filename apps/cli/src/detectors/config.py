"""Shared detector config resolution and type mapping."""

from __future__ import annotations

from typing import Any

from ..models.generated_detectors import (
    BrokenLinksDetectorConfig,
    CustomDetectorConfig,
    DetectorConfig,
    PIIDetectorConfig,
    SecretsDetectorConfig,
    ThreatDetectorConfig,
)

type DetectorTypedConfig = (
    DetectorConfig
    | CustomDetectorConfig
    | SecretsDetectorConfig
    | PIIDetectorConfig
    | ThreatDetectorConfig
    | BrokenLinksDetectorConfig
)

_DETECTOR_NAME_BY_TYPE: dict[str, str] = {
    "SECRETS": "secrets",
    "PII": "pii",
    "YARA": "yara",
    "BROKEN_LINKS": "broken_links",
    "CODE_SECURITY": "code_security",
    "CUSTOM": "custom",
}

_DETECTOR_CONFIG_BY_TYPE: dict[str, type[DetectorConfig]] = {
    "SECRETS": SecretsDetectorConfig,
    "PII": PIIDetectorConfig,
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
