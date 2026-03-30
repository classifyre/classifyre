"""Additional detector implementations for newly introduced detector types.

These detectors provide lightweight, dependency-safe heuristics so new detector
entries can initialize and run without runtime registry failures.
"""

from __future__ import annotations

import re
from collections import Counter
from statistics import mean
from typing import ClassVar

from ..models.generated_single_asset_scan_results import (
    DetectionResult,
    DetectorType,
    Severity,
)
from .base import BaseDetector

_TEXT_TYPES = [
    "text/plain",
    "text/html",
    "text/markdown",
    "application/json",
]


class _KeywordDetector(BaseDetector):
    detector_type = "keyword"
    detector_name = "keyword"
    output_type: DetectorType | None = None
    category = "CONTENT"
    finding_type = "keyword"
    keywords: tuple[str, ...] = ()

    async def detect(self, content: str, content_type: str = "text/plain") -> list[DetectionResult]:
        text = content.strip().lower()
        if not text or not self.keywords or self.output_type is None:
            return []

        matches = [keyword for keyword in self.keywords if keyword in text]
        if not matches:
            return []

        score = min(0.98, 0.6 + (0.08 * len(matches)))
        threshold = self.config.confidence_threshold or 0.7
        if score < threshold:
            return []

        severity = Severity.high if score >= 0.9 else Severity.medium
        return [
            DetectionResult(
                detector_type=self.output_type,
                finding_type=self.finding_type,
                category=self.category,
                severity=severity,
                confidence=score,
                matched_content=content[:512],
                location=None,
                metadata={
                    "model": "heuristic",
                    "matched_keywords": matches[:8],
                },
            )
        ]

    def get_supported_content_types(self) -> list[str]:
        return _TEXT_TYPES


class PlagiarismDetector(BaseDetector):
    detector_type = "plagiarism"
    detector_name = "plagiarism"

    async def detect(self, content: str, content_type: str = "text/plain") -> list[DetectionResult]:
        lines = [line.strip().lower() for line in content.splitlines() if line.strip()]
        if len(lines) < 4:
            return []

        repeated = [line for line, count in Counter(lines).items() if count > 1 and len(line) > 30]
        if not repeated:
            return []

        confidence = min(0.95, 0.65 + (0.08 * len(repeated)))
        threshold = self.config.confidence_threshold or 0.7
        if confidence < threshold:
            return []

        return [
            DetectionResult(
                detector_type=DetectorType.PLAGIARISM,
                finding_type="potential_reuse",
                category="QUALITY",
                severity=Severity.medium,
                confidence=confidence,
                matched_content=repeated[0][:256],
                location=None,
                metadata={
                    "model": "heuristic",
                    "repeated_segments": len(repeated),
                },
            )
        ]

    def get_supported_content_types(self) -> list[str]:
        return _TEXT_TYPES


class ImageViolenceDetector(_KeywordDetector):
    detector_type = "image_violence"
    detector_name = "image_violence"
    output_type = DetectorType.IMAGE_VIOLENCE
    category = "CONTENT"
    finding_type = "violence_signal"
    keywords = (
        "blood",
        "weapon",
        "gun",
        "shooting",
        "knife",
        "explosion",
        "injury",
    )

    def get_supported_content_types(self) -> list[str]:
        return [*_TEXT_TYPES, "image/*"]


class OCRPIIDetector(BaseDetector):
    detector_type = "ocr_pii"
    detector_name = "ocr_pii"

    _patterns: ClassVar[dict[str, re.Pattern[str]]] = {
        "email": re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
        "phone": re.compile(
            r"\b(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)\d{3,4}[\s.-]?\d{3,4}\b"
        ),
        "credit_card": re.compile(r"\b(?:\d[ -]*?){13,16}\b"),
        "iban": re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b"),
    }

    async def detect(self, content: str, content_type: str = "text/plain") -> list[DetectionResult]:
        if not content.strip():
            return []

        findings: list[DetectionResult] = []
        threshold = self.config.confidence_threshold or 0.7
        for label, pattern in self._patterns.items():
            for match in pattern.finditer(content):
                confidence = 0.85
                if confidence < threshold:
                    continue
                findings.append(
                    DetectionResult(
                        detector_type=DetectorType.OCR_PII,
                        finding_type=f"ocr_{label}",
                        category="PRIVACY",
                        severity=Severity.high
                        if label in {"credit_card", "iban"}
                        else Severity.medium,
                        confidence=confidence,
                        matched_content=match.group(0),
                        location=None,
                        metadata={
                            "model": "ocr-text-heuristic",
                            "entity": label,
                        },
                    )
                )

                max_findings = self.config.max_findings
                if (
                    isinstance(max_findings, int)
                    and max_findings > 0
                    and len(findings) >= max_findings
                ):
                    return findings

        return findings

    def get_supported_content_types(self) -> list[str]:
        return [*_TEXT_TYPES, "image/*"]


class DeidScoreDetector(BaseDetector):
    detector_type = "deid_score"
    detector_name = "deid_score"

    _residual_patterns: ClassVar[list[re.Pattern[str]]] = [
        re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
        re.compile(r"\b(?:\d[ -]*?){13,16}\b"),
        re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
        re.compile(r"\b\d{11}\b"),
    ]

    async def detect(self, content: str, content_type: str = "text/plain") -> list[DetectionResult]:
        if not content.strip():
            return []

        residual = 0
        for pattern in self._residual_patterns:
            residual += len(pattern.findall(content))

        # Heuristic completeness proxy (0-100), higher is better.
        score = max(0.0, min(100.0, 100.0 - (residual * 12.5)))
        confidence = max(0.5, min(0.99, score / 100.0))

        risk_tier = "LOW" if score >= 80 else "MEDIUM" if score >= 50 else "HIGH"
        severity = (
            Severity.info
            if risk_tier == "LOW"
            else Severity.medium
            if risk_tier == "MEDIUM"
            else Severity.high
        )

        return [
            DetectionResult(
                detector_type=DetectorType.DEID_SCORE,
                finding_type=f"deid_score:{int(score)}",
                category="PRIVACY",
                severity=severity,
                confidence=confidence,
                matched_content=content[:128],
                location=None,
                metadata={
                    "score": score,
                    "risk_tier": risk_tier,
                    "residual_pii_spans": residual,
                    "model": "heuristic",
                },
            )
        ]

    def get_supported_content_types(self) -> list[str]:
        return _TEXT_TYPES


class HateSpeechDetector(_KeywordDetector):
    detector_type = "hate_speech"
    detector_name = "hate_speech"
    output_type = DetectorType.HATE_SPEECH
    category = "CONTENT"
    finding_type = "targeted_hate"
    keywords = (
        "go back to",
        "subhuman",
        "inferior race",
        "expel all",
        "ethnic cleansing",
        "kill them all",
    )


class AIGeneratedDetector(_KeywordDetector):
    detector_type = "ai_generated"
    detector_name = "ai_generated"
    output_type = DetectorType.AI_GENERATED
    category = "CONTENT"
    finding_type = "ai_likelihood"
    keywords = (
        "as an ai language model",
        "i cannot provide",
        "in conclusion",
        "it is important to note",
        "furthermore",
    )


class ContentQualityDetector(BaseDetector):
    detector_type = "content_quality"
    detector_name = "content_quality"

    async def detect(self, content: str, content_type: str = "text/plain") -> list[DetectionResult]:
        text = content.strip()
        if not text:
            return []

        words = re.findall(r"\b\w+\b", text)
        sentences = re.split(r"[.!?]+", text)
        non_empty_sentences = [segment for segment in sentences if segment.strip()]
        if not words or not non_empty_sentences:
            return []

        avg_sentence_length = len(words) / len(non_empty_sentences)
        long_word_ratio = sum(1 for word in words if len(word) >= 9) / len(words)
        punctuation_ratio = sum(1 for ch in text if ch in "!?") / max(len(text), 1)

        quality_score = 100.0
        quality_score -= abs(avg_sentence_length - 18) * 1.8
        quality_score += min(20.0, long_word_ratio * 100.0 * 0.25)
        quality_score -= min(20.0, punctuation_ratio * 100.0 * 0.2)
        quality_score = max(0.0, min(100.0, quality_score))

        if quality_score >= 80:
            severity = Severity.info
        elif quality_score >= 55:
            severity = Severity.low
        elif quality_score >= 35:
            severity = Severity.medium
        else:
            severity = Severity.high

        return [
            DetectionResult(
                detector_type=DetectorType.CONTENT_QUALITY,
                finding_type=f"quality_score:{round(quality_score)}",
                category="QUALITY",
                severity=severity,
                confidence=max(0.5, min(0.99, quality_score / 100.0)),
                matched_content=text[:256],
                location=None,
                metadata={
                    "model": "heuristic",
                    "quality_score": quality_score,
                    "avg_sentence_length": avg_sentence_length,
                    "long_word_ratio": long_word_ratio,
                },
            )
        ]

    def get_supported_content_types(self) -> list[str]:
        return _TEXT_TYPES


class BiasDetector(_KeywordDetector):
    detector_type = "bias"
    detector_name = "bias"
    output_type = DetectorType.BIAS
    category = "FAIRNESS"
    finding_type = "bias_signal"
    keywords = (
        "you people",
        "naturally inferior",
        "not fit for",
        "too old for this",
        "typical of them",
    )


class DuplicateDetector(BaseDetector):
    detector_type = "duplicate"
    detector_name = "duplicate"

    async def detect(self, content: str, content_type: str = "text/plain") -> list[DetectionResult]:
        lines = [line.strip().lower() for line in content.splitlines() if line.strip()]
        if len(lines) < 4:
            return []

        counts = Counter(lines)
        repeated_lines = [line for line, count in counts.items() if count > 1 and len(line) > 15]
        if not repeated_lines:
            return []

        duplicate_ratio = len(repeated_lines) / len(set(lines))
        confidence = min(0.98, 0.7 + (duplicate_ratio * 0.4))
        threshold = self.config.confidence_threshold or 0.7
        if confidence < threshold:
            return []

        return [
            DetectionResult(
                detector_type=DetectorType.DUPLICATE,
                finding_type="near_duplicate",
                category="QUALITY",
                severity=Severity.medium,
                confidence=confidence,
                matched_content=repeated_lines[0][:256],
                location=None,
                metadata={
                    "model": "heuristic",
                    "duplicate_ratio": duplicate_ratio,
                    "repeated_segments": len(repeated_lines),
                },
            )
        ]

    def get_supported_content_types(self) -> list[str]:
        return _TEXT_TYPES


class DomainClassDetector(BaseDetector):
    detector_type = "domain_class"
    detector_name = "domain_class"

    _domain_keywords: ClassVar[dict[str, tuple[str, ...]]] = {
        "finance": ("invoice", "revenue", "payment", "tax", "balance", "loan"),
        "health": ("patient", "diagnosis", "clinical", "treatment", "medical"),
        "legal": ("contract", "liability", "clause", "regulation", "court"),
        "hr": ("employee", "payroll", "hiring", "benefits", "policy"),
        "technology": ("api", "deployment", "software", "infrastructure", "code"),
    }

    async def detect(self, content: str, content_type: str = "text/plain") -> list[DetectionResult]:
        text = content.strip().lower()
        if not text:
            return []

        best_label = "other"
        best_hits = 0
        for label, keywords in self._domain_keywords.items():
            hits = sum(1 for keyword in keywords if keyword in text)
            if hits > best_hits:
                best_hits = hits
                best_label = label

        confidence = 0.72 if best_hits == 0 else min(0.97, 0.62 + (best_hits * 0.1))
        threshold = self.config.confidence_threshold or 0.65
        if confidence < threshold:
            return []

        return [
            DetectionResult(
                detector_type=DetectorType.DOMAIN_CLASS,
                finding_type=f"domain:{best_label}",
                category="CLASSIFICATION",
                severity=Severity.info,
                confidence=confidence,
                matched_content=content[:256],
                location=None,
                metadata={
                    "model": "heuristic",
                    "label": best_label,
                    "hits": best_hits,
                },
            )
        ]

    def get_supported_content_types(self) -> list[str]:
        return _TEXT_TYPES


class ContentTypeDetector(BaseDetector):
    detector_type = "content_type"
    detector_name = "content_type"

    _type_keywords: ClassVar[dict[str, tuple[str, ...]]] = {
        "factual": ("according to", "data shows", "reported", "statistics", "evidence"),
        "opinion": ("i believe", "in my view", "we think", "should", "personally"),
        "promotional": ("buy now", "limited offer", "book today", "subscribe", "free trial"),
        "instructional": ("step 1", "how to", "follow these", "instructions", "setup"),
    }

    async def detect(self, content: str, content_type: str = "text/plain") -> list[DetectionResult]:
        text = content.strip().lower()
        if not text:
            return []

        best_label = "factual"
        best_hits = 0
        for label, keywords in self._type_keywords.items():
            hits = sum(1 for keyword in keywords if keyword in text)
            if hits > best_hits:
                best_hits = hits
                best_label = label

        confidence = 0.68 if best_hits == 0 else min(0.96, 0.6 + (best_hits * 0.12))
        threshold = self.config.confidence_threshold or 0.65
        if confidence < threshold:
            return []

        return [
            DetectionResult(
                detector_type=DetectorType.CONTENT_TYPE,
                finding_type=f"content_type:{best_label}",
                category="CLASSIFICATION",
                severity=Severity.info,
                confidence=confidence,
                matched_content=content[:256],
                location=None,
                metadata={
                    "model": "heuristic",
                    "label": best_label,
                    "hits": best_hits,
                },
            )
        ]

    def get_supported_content_types(self) -> list[str]:
        return _TEXT_TYPES


class SensitivityTierDetector(BaseDetector):
    detector_type = "sensitivity_tier"
    detector_name = "sensitivity_tier"

    async def detect(self, content: str, content_type: str = "text/plain") -> list[DetectionResult]:
        text = content.strip().lower()
        if not text:
            return []

        if any(token in text for token in ("password", "private key", "ssn", "passport")):
            tier = "RESTRICTED"
            confidence = 0.94
        elif any(token in text for token in ("salary", "invoice", "iban", "confidential")):
            tier = "CONFIDENTIAL"
            confidence = 0.88
        elif any(token in text for token in ("internal", "employee", "roadmap", "draft")):
            tier = "INTERNAL"
            confidence = 0.8
        else:
            tier = "PUBLIC"
            confidence = 0.72

        threshold = self.config.confidence_threshold or 0.7
        if confidence < threshold:
            return []

        return [
            DetectionResult(
                detector_type=DetectorType.SENSITIVITY_TIER,
                finding_type=f"sensitivity:{tier}",
                category="CLASSIFICATION",
                severity=Severity.info,
                confidence=confidence,
                matched_content=content[:256],
                location=None,
                metadata={
                    "model": "heuristic",
                    "tier": tier,
                },
            )
        ]

    def get_supported_content_types(self) -> list[str]:
        return _TEXT_TYPES


class JurisdictionTagDetector(BaseDetector):
    detector_type = "jurisdiction_tag"
    detector_name = "jurisdiction_tag"

    _jurisdiction_keywords: ClassVar[dict[str, tuple[str, ...]]] = {
        "GDPR": ("gdpr", "european union", "eu user", "data subject"),
        "DSA": ("digital services act", "dsa", "platform moderation"),
        "CCPA": ("ccpa", "california consumer privacy", "california resident"),
        "HIPAA": ("hipaa", "phi", "protected health information"),
        "NDSG": ("ndsg", "swiss", "federal act on data protection"),
    }

    async def detect(self, content: str, content_type: str = "text/plain") -> list[DetectionResult]:
        text = content.strip().lower()
        if not text:
            return []

        matches: list[str] = []
        confidences: list[float] = []
        for tag, keywords in self._jurisdiction_keywords.items():
            hit_count = sum(1 for keyword in keywords if keyword in text)
            if hit_count == 0:
                continue
            matches.append(tag)
            confidences.append(min(0.95, 0.6 + (hit_count * 0.12)))

        if not matches:
            return []

        confidence = mean(confidences)
        threshold = self.config.confidence_threshold or 0.65
        if confidence < threshold:
            return []

        return [
            DetectionResult(
                detector_type=DetectorType.JURISDICTION_TAG,
                finding_type=f"jurisdictions:{','.join(matches)}",
                category="CLASSIFICATION",
                severity=Severity.info,
                confidence=confidence,
                matched_content=content[:256],
                location=None,
                metadata={
                    "model": "heuristic",
                    "jurisdictions": matches,
                },
            )
        ]

    def get_supported_content_types(self) -> list[str]:
        return _TEXT_TYPES
