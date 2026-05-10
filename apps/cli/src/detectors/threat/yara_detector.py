"""YARA-based threat detector — compiles structured rule objects into a live ruleset."""

import logging
import re

from ...models.generated_detectors import (
    DetectorConfig,
    Severity,
    ThreatDetectorConfig,
    YaraRuleConfig,
)
from ...models.generated_single_asset_scan_results import DetectionResult, DetectorType, Location
from ..base import BaseDetector
from ..dependencies import require_module

logger = logging.getLogger(__name__)

_SEVERITY_MAP: dict[str, Severity] = {
    "critical": Severity.critical,
    "high": Severity.high,
    "medium": Severity.medium,
    "low": Severity.low,
}

_SEVERITY_ORDER: dict[str, int] = {"low": 1, "medium": 2, "high": 3, "critical": 4}

_SAFE_NAME = re.compile(r"[^A-Za-z0-9_]")


def _sanitize_name(name: str) -> str:
    sanitized = _SAFE_NAME.sub("_", name)
    return ("_" + sanitized) if sanitized and sanitized[0].isdigit() else sanitized or "Rule"


def _build_source(rules: list[YaraRuleConfig]) -> str:
    parts: list[str] = []
    for rule in rules:
        strings_block = "\n".join(
            f"        $s{i} = {pattern}" for i, pattern in enumerate(rule.strings)
        )
        desc = (rule.description or "").replace('"', '\\"')
        sev = rule.severity.value if hasattr(rule.severity, "value") else str(rule.severity)
        cat = (rule.category or "").replace('"', '\\"')
        parts.append(
            f"rule {_sanitize_name(rule.name)} {{\n"
            f"    meta:\n"
            f'        description = "{desc}"\n'
            f'        severity = "{sev}"\n'
            f'        category = "{cat}"\n'
            f"    strings:\n"
            f"{strings_block}\n"
            f"    condition:\n"
            f"        {rule.condition}\n"
            f"}}"
        )
    return "\n\n".join(parts)


class YaraDetector(BaseDetector):
    """
    Threat detector powered by yara-python.

    Takes structured rule objects from config, compiles them into a YARA ruleset,
    and scans extracted text or raw bytes for matches. Use the bundled examples in
    all_detectors_examples.json as starting points and extend with custom rules.
    """

    detector_type = "yara"
    detector_name = "yara"

    def __init__(self, config: DetectorConfig | None = None) -> None:
        super().__init__(config)
        self._yara = require_module("yara", "yara", ["security"])
        self._threat_config = (
            config if isinstance(config, ThreatDetectorConfig) else ThreatDetectorConfig()
        )
        self._rules = self._compile()

    def _compile(self) -> object | None:
        rules = self._threat_config.rules
        if not rules:
            return None
        source = _build_source(rules)
        try:
            return self._yara.compile(source=source)
        except Exception:
            logger.exception("YARA compilation failed")
            return None

    async def detect(
        self, content: str | bytes, content_type: str = "text/plain"
    ) -> list[DetectionResult]:
        if self._rules is None:
            return []

        data = content if isinstance(content, bytes) else content.encode("utf-8", errors="ignore")
        timeout = self._threat_config.timeout or 60

        try:
            matches = self._rules.match(data=data, timeout=timeout)
        except Exception as exc:
            if "timeout" in str(exc).lower():
                logger.warning("YARA scan timed out after %ds on %s", timeout, content_type)
            else:
                logger.error("YARA scan error on %s: %s", content_type, exc)
            return []

        threshold = self._threat_config.confidence_threshold or 0.7
        results: list[DetectionResult] = []

        for match in matches:
            meta: dict[str, object] = getattr(match, "meta", {}) or {}
            rule_name = str(getattr(match, "rule", "unknown"))
            description = str(meta.get("description", rule_name))
            severity = _SEVERITY_MAP.get(str(meta.get("severity", "medium")), Severity.medium)

            matched_texts = [
                inst.matched_data.decode("utf-8", errors="replace")
                for sm in getattr(match, "strings", [])
                for inst in getattr(sm, "instances", [])
            ]
            count = len(matched_texts)
            confidence = min(0.70 + max(count - 1, 0) * 0.04, 0.99)
            if confidence < threshold:
                continue

            results.append(
                DetectionResult(
                    detector_type=DetectorType.YARA,
                    finding_type=rule_name,
                    category="THREAT",
                    severity=severity,
                    confidence=confidence,
                    matched_content=", ".join(matched_texts[:3]),
                    location=Location(
                        path=f"yara:{content_type}",
                        description=description,
                    ),
                    metadata={
                        "rule": rule_name,
                        "description": description,
                        "match_count": count,
                        "tags": list(getattr(match, "tags", [])),
                    },
                )
            )

        results.sort(
            key=lambda r: (_SEVERITY_ORDER.get(r.severity.value, 0), r.confidence),
            reverse=True,
        )
        max_f = self._threat_config.max_findings
        return results[:max_f] if max_f and len(results) > max_f else results

    def get_supported_content_types(self) -> list[str]:
        return [
            "text/plain",
            "text/html",
            "text/csv",
            "text/markdown",
            "text/x-python",
            "text/x-shellscript",
            "text/javascript",
            "application/json",
            "application/xml",
            "application/pdf",
            "application/octet-stream",
            "application/x-sh",
            "application/x-executable",
            "application/javascript",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ]

    def requires_gpu(self) -> bool:
        return False
