"""Spam detector using a compact BERT classifier."""

import logging
import os
import re
from typing import Any

from ...models.generated_detectors import DetectorConfig, Severity, SpamDetectorConfig
from ...models.generated_single_asset_scan_results import (
    DetectionResult,
    DetectorType,
)
from ..base import BaseDetector
from ..dependencies import MissingDependencyError, ensure_torch, require_module

logger = logging.getLogger(__name__)


class SpamDetector(BaseDetector):
    """Detect spam content with `mrm8488/bert-tiny-finetuned-sms-spam-detection`."""

    detector_type = "spam"
    detector_name = "spam"

    _DEFAULT_MODEL = "mrm8488/bert-tiny-finetuned-sms-spam-detection"

    def __init__(self, config: DetectorConfig | None = None):
        super().__init__(config)
        self.classifier: Any | None = None
        self._transformers: Any | None = None
        cfg_model = (
            getattr(self.config, "model", None)
            if isinstance(self.config, SpamDetectorConfig)
            else None
        )
        self._model_id = cfg_model or self._DEFAULT_MODEL
        self._max_length = 512
        # Model inference for this detector has proven unstable in some runtime
        # environments (native crashes). Keep robust heuristic detection enabled
        # by default and allow model inference as an explicit opt-in.
        self._use_model = os.environ.get("CLASSIFYRE_ENABLE_SPAM_MODEL", "0").strip().lower() in {
            "1",
            "true",
            "yes",
        }

        if self._use_model:
            try:
                ensure_torch("spam", ["quality", "detectors"])
                self._transformers = require_module(
                    "transformers",
                    "spam",
                    ["quality", "detectors"],
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
            max_length=self._max_length,
        )

    def _predict(self, content: str) -> list[dict[str, Any]]:
        self._ensure_classifier()
        try:
            raw = self.classifier(
                content,
                top_k=None,
                truncation=True,
                max_length=self._max_length,
            )
        except TypeError:
            raw = self.classifier(
                content,
                return_all_scores=True,
                truncation=True,
                max_length=self._max_length,
            )

        if isinstance(raw, list) and raw and isinstance(raw[0], list):
            return raw[0]
        if isinstance(raw, list) and raw and isinstance(raw[0], dict):
            return raw
        if isinstance(raw, dict):
            return [raw]
        return []

    @staticmethod
    def _is_spam_label(label: str) -> bool:
        normalized = label.upper()
        return "SPAM" in normalized or normalized in {"LABEL_1", "1"}

    async def detect(self, content: str, content_type: str = "text/plain") -> list[DetectionResult]:
        if not content.strip():
            return []

        # Safe default: lightweight lexical detector that cannot crash the process.
        heuristic_result = self._detect_with_heuristics(content)
        if heuristic_result is not None:
            return [heuristic_result]

        if not getattr(self, "_use_model", True):
            return []

        try:
            predictions = self._predict(content)
            if not predictions:
                return []
        except Exception as exc:
            logger.error(f"Spam detection failed: {exc}")
            return []

        threshold = self.config.confidence_threshold or 0.7
        ranked = sorted(predictions, key=lambda item: float(item.get("score", 0.0)), reverse=True)

        for candidate in ranked:
            label = str(candidate.get("label", "UNKNOWN"))
            score = float(candidate.get("score", 0.0))
            if not self._is_spam_label(label) or score < threshold:
                continue

            severity = Severity.high if score >= 0.9 else Severity.medium
            return [
                DetectionResult(
                    detector_type=DetectorType.SPAM,
                    finding_type="spam",
                    category="QUALITY",
                    severity=severity,
                    confidence=score,
                    matched_content=content[:512],
                    location=None,
                    metadata={
                        "model": self._model_id,
                        "predicted_label": label,
                        "scores": ranked[:3],
                    },
                )
            ]

        return []

    def get_supported_content_types(self) -> list[str]:
        return [
            "text/plain",
            "text/html",
            "text/markdown",
            "application/json",
        ]

    def _detect_with_heuristics(self, content: str) -> DetectionResult | None:
        text = content.strip()
        text_lower = text.lower()

        keyword_matches = sum(
            1
            for token in (
                "free",
                "win",
                "winner",
                "urgent",
                "limited time",
                "act now",
                "click here",
                "exclusive offer",
                "guaranteed",
                "cash",
                "prize",
                "loan",
            )
            if token in text_lower
        )
        exclamation_count = text.count("!")
        url_count = len(re.findall(r"https?://", text_lower))

        spam_score = min(
            1.0, 0.5 + (keyword_matches * 0.1) + (url_count * 0.1) + (exclamation_count * 0.03)
        )
        threshold = self.config.confidence_threshold or 0.7

        if keyword_matches < 2 and url_count == 0:
            return None
        if spam_score < threshold:
            return None

        return DetectionResult(
            detector_type=DetectorType.SPAM,
            finding_type="spam",
            category="QUALITY",
            severity=Severity.high if spam_score >= 0.9 else Severity.medium,
            confidence=spam_score,
            matched_content=text[:512],
            location=None,
            metadata={
                "model": "heuristic",
                "keyword_matches": keyword_matches,
                "url_count": url_count,
                "exclamation_count": exclamation_count,
            },
        )
