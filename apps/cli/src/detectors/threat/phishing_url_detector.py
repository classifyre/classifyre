"""Phishing URL detector using URLBERT tiny model."""

import json
import logging
from urllib.parse import urlparse

from ...models.generated_detectors import DetectorConfig, PhishingUrlDetectorConfig, Severity
from ...models.generated_single_asset_scan_results import (
    DetectionResult,
    DetectorType,
)
from ..base import BaseDetector
from ..dependencies import MissingDependencyError, ensure_torch, require_module

logger = logging.getLogger(__name__)


class PhishingURLDetector(BaseDetector):
    """Detect malicious/phishing URLs with URLBERT-tiny."""

    detector_type = "phishing_url"
    detector_name = "phishing_url"

    _DEFAULT_MODEL = "CrabInHoney/urlbert-tiny-phishing-classifier"

    def __init__(self, config: DetectorConfig | None = None):
        super().__init__(config)
        self.classifier = None
        self._transformers = None
        cfg_model = (
            getattr(self.config, "model", None)
            if isinstance(self.config, PhishingUrlDetectorConfig)
            else None
        )
        self._model_id = cfg_model or self._DEFAULT_MODEL

        try:
            ensure_torch("phishing_url", ["threat-ml", "security", "detectors"])
            self._transformers = require_module(
                "transformers",
                "phishing_url",
                ["threat-ml", "security", "detectors"],
            )
        except MissingDependencyError:
            raise

    def _ensure_classifier(self) -> None:
        if self.classifier is not None:
            return
        if self._transformers is None:
            raise RuntimeError("Transformers module is not initialized")

        self.classifier = self._transformers.pipeline(
            "text-classification",
            model=self._model_id,
            device=-1,
            truncation=True,
            max_length=256,
        )

    def _predict(self, text: str) -> list[dict]:
        self._ensure_classifier()
        try:
            raw = self.classifier(text, top_k=None, truncation=True, max_length=256)
        except TypeError:
            raw = self.classifier(text, return_all_scores=True, truncation=True, max_length=256)

        if isinstance(raw, list) and raw and isinstance(raw[0], list):
            return raw[0]
        if isinstance(raw, list) and raw and isinstance(raw[0], dict):
            return raw
        if isinstance(raw, dict):
            return [raw]
        return []

    @staticmethod
    def _is_phishing_label(label: str) -> bool:
        normalized = label.upper()
        dangerous_tokens = ("PHISH", "MALWARE", "DEFACEMENT")
        return any(token in normalized for token in dangerous_tokens) or normalized in {
            "LABEL_1",
            "1",
        }

    def _extract_urls(self, content: str, content_type: str) -> list[str]:
        if content_type == "application/json":
            try:
                data = json.loads(content)
            except Exception:
                data = None
            if isinstance(data, dict):
                values = [str(value) for value in data.values() if isinstance(value, str)]
            elif isinstance(data, list):
                values = [str(value) for value in data if isinstance(value, str)]
            else:
                values = [content]
        else:
            values = [content]

        candidates: list[str] = []
        for value in values:
            for token in value.split():
                stripped = token.strip("()[]{}<>,;\"'")
                if not stripped:
                    continue
                if stripped.startswith("www."):
                    stripped = f"https://{stripped}"
                if not stripped.startswith(("http://", "https://")):
                    continue
                parsed = urlparse(stripped)
                if parsed.scheme and parsed.netloc:
                    candidates.append(stripped)
        return list(dict.fromkeys(candidates))

    async def detect(self, content: str, content_type: str = "text/plain") -> list[DetectionResult]:
        if not content.strip():
            return []

        urls = self._extract_urls(content, content_type)
        if not urls:
            return []

        threshold = self.config.confidence_threshold or 0.7
        max_findings = self.config.max_findings or 25
        findings: list[DetectionResult] = []

        for url in urls:
            try:
                predictions = self._predict(url)
            except Exception as exc:
                logger.error(f"Phishing URL detection failed for {url}: {exc}")
                continue

            ranked = sorted(
                predictions, key=lambda item: float(item.get("score", 0.0)), reverse=True
            )
            for candidate in ranked:
                label = str(candidate.get("label", "UNKNOWN"))
                score = float(candidate.get("score", 0.0))
                if not self._is_phishing_label(label) or score < threshold:
                    continue

                start = content.find(url)
                start = max(start, 0)

                findings.append(
                    DetectionResult(
                        detector_type=DetectorType.PHISHING_URL,
                        finding_type="phishing_url",
                        category="THREAT",
                        severity=Severity.high,
                        confidence=score,
                        matched_content=url,
                        location=None,
                        metadata={
                            "model": self._model_id,
                            "predicted_label": label,
                            "scores": ranked[:3],
                        },
                    )
                )
                break

            if len(findings) >= max_findings:
                break

        return findings

    def get_supported_content_types(self) -> list[str]:
        return [
            "text/plain",
            "text/html",
            "text/markdown",
            "application/json",
        ]
