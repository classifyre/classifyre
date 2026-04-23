"""Threat detector using YARA rules."""

import logging
from dataclasses import dataclass

from ...models.generated_detectors import DetectorConfig, Severity
from ...models.generated_single_asset_scan_results import DetectionResult, DetectorType, Location
from ..base import BaseDetector

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _RulePattern:
    display: str
    value: bytes


@dataclass(frozen=True)
class _CompiledRule:
    name: str
    description: str
    severity: Severity
    patterns: tuple[_RulePattern, ...]
    min_matches: int


class YaraDetector(BaseDetector):
    """
    Detector for threats and malware using YARA rules.

    Detects various threat patterns including:
    - Suspicious Windows API calls
    - Shell script exploits
    - Malware patterns
    - Potentially malicious code
    """

    detector_type = "yara"
    detector_name = "yara"

    def __init__(self, config: DetectorConfig | None = None):
        """Initialize YARA-style threat detector with built-in rules."""
        super().__init__(config)

        self.rules = (
            _CompiledRule(
                name="Suspicious_Windows_APIs",
                description="Detects suspicious Windows API calls",
                severity=Severity.high,
                patterns=(
                    self._pattern("CreateRemoteThread"),
                    self._pattern("VirtualAllocEx"),
                    self._pattern("WriteProcessMemory"),
                    self._pattern("VirtualAlloc"),
                    self._pattern("LoadLibrary"),
                    self._pattern("GetProcAddress"),
                ),
                min_matches=1,
            ),
            _CompiledRule(
                name="Suspicious_Shell_Commands",
                description="Detects suspicious shell commands",
                severity=Severity.high,
                patterns=(
                    self._pattern("rm -rf /"),
                    self._pattern("curl"),
                    self._pattern("wget"),
                    self._pattern("> /dev/null"),
                    self._pattern("eval("),
                    self._pattern("base64 -d"),
                ),
                min_matches=2,
            ),
            _CompiledRule(
                name="Potential_Code_Injection",
                description="Detects potential code injection patterns",
                severity=Severity.critical,
                patterns=(
                    self._pattern("eval("),
                    self._pattern("exec("),
                    self._pattern("system("),
                    self._pattern("shell_exec"),
                    self._pattern("passthru"),
                ),
                min_matches=1,
            ),
            _CompiledRule(
                name="Suspicious_Network_Activity",
                description="Detects suspicious network activity patterns",
                severity=Severity.medium,
                patterns=(
                    self._pattern("nc -e"),
                    self._pattern("netcat"),
                    self._pattern("/dev/tcp/"),
                    self._pattern("socket.connect"),
                ),
                min_matches=1,
            ),
            _CompiledRule(
                name="Obfuscation_Patterns",
                description="Detects common obfuscation patterns",
                severity=Severity.medium,
                patterns=(
                    self._pattern("base64"),
                    self._pattern("\\x", display="\\x"),
                    self._pattern("chr("),
                    self._pattern("fromCharCode"),
                ),
                min_matches=2,
            ),
        )
        logger.debug("Initialized YARA detector with built-in rules")

    async def detect(
        self, content: str | bytes, content_type: str = "application/octet-stream"
    ) -> list[DetectionResult]:
        """
        Detect threats using YARA rules.

        Args:
            content: Content to scan (bytes or string)
            content_type: MIME type

        Returns:
            List of detection results for found threats
        """
        results: list[DetectionResult] = []

        try:
            # Convert string to bytes if needed
            if isinstance(content, str):
                content_bytes = content.encode("utf-8", errors="ignore")
            else:
                content_bytes = content

            content_lower = content_bytes.lower()

            for rule in self.rules:
                matched_strings = self._match_rule(rule, content_lower)
                if len(matched_strings) < rule.min_matches:
                    continue

                confidence = min(0.7 + (len(matched_strings) * 0.05), 0.99)
                if confidence < (self.config.confidence_threshold or 0.7):
                    continue

                results.append(
                    DetectionResult(
                        detector_type=DetectorType.YARA,
                        finding_type=rule.name,
                        category="THREAT",
                        severity=rule.severity,
                        confidence=confidence,
                        matched_content=", ".join(matched_strings[:3]),
                        location=Location(
                            path=f"yara:{content_type}",
                            description=f"matched rule {rule.name}",
                        ),
                        metadata={
                            "description": rule.description,
                            "match_count": len(matched_strings),
                            "rule_name": rule.name,
                        },
                    )
                )

        except Exception as e:
            logger.error(f"Error detecting threats: {e}")
            logger.exception(e)

        # Sort by severity and confidence
        results.sort(key=lambda r: (r.severity.value, r.confidence), reverse=True)

        # Apply max_findings limit if configured
        if self.config.max_findings and len(results) > self.config.max_findings:
            results = results[: self.config.max_findings]

        return results

    def get_supported_content_types(self) -> list[str]:
        """Return supported content types for threat detection."""
        return [
            "application/octet-stream",
            "application/x-executable",
            "application/x-sh",
            "application/x-python",
            "application/javascript",
            "text/x-python",
            "text/x-shellscript",
            "text/plain",
        ]

    def requires_gpu(self) -> bool:
        """YARA runs on CPU only."""
        return False

    @staticmethod
    def _pattern(value: str, *, display: str | None = None) -> _RulePattern:
        rendered = display or value
        return _RulePattern(display=rendered, value=value.lower().encode("utf-8"))

    @staticmethod
    def _match_rule(rule: _CompiledRule, content_lower: bytes) -> list[str]:
        return [pattern.display for pattern in rule.patterns if pattern.value in content_lower]
