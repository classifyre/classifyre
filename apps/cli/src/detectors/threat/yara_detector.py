"""Threat detector using YARA rules."""

import logging

from ...models.generated_detectors import DetectorConfig, Severity
from ...models.generated_single_asset_scan_results import DetectionResult, DetectorType, Location
from ..base import BaseDetector
from ..dependencies import MissingDependencyError, require_module

logger = logging.getLogger(__name__)


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
        """Initialize YARA threat detector with built-in rules."""
        super().__init__(config)

        try:
            yara_module = require_module("yara", "yara", ["security", "detectors"])

            # Define YARA rules for common threats
            rules_source = """
            rule Suspicious_Windows_APIs {
                meta:
                    description = "Detects suspicious Windows API calls"
                    severity = "high"
                strings:
                    $api1 = "CreateRemoteThread" nocase
                    $api2 = "VirtualAllocEx" nocase
                    $api3 = "WriteProcessMemory" nocase
                    $api4 = "VirtualAlloc" nocase
                    $api5 = "LoadLibrary" nocase
                    $api6 = "GetProcAddress" nocase
                condition:
                    any of ($api*)
            }

            rule Suspicious_Shell_Commands {
                meta:
                    description = "Detects suspicious shell commands"
                    severity = "high"
                strings:
                    $cmd1 = "rm -rf /" nocase
                    $cmd2 = "curl" nocase
                    $cmd3 = "wget" nocase
                    $cmd4 = "> /dev/null" nocase
                    $cmd5 = "eval(" nocase
                    $cmd6 = "base64 -d" nocase
                condition:
                    2 of ($cmd*)
            }

            rule Potential_Code_Injection {
                meta:
                    description = "Detects potential code injection patterns"
                    severity = "critical"
                strings:
                    $inject1 = "eval(" nocase
                    $inject2 = "exec(" nocase
                    $inject3 = "system(" nocase
                    $inject4 = "shell_exec" nocase
                    $inject5 = "passthru" nocase
                condition:
                    any of ($inject*)
            }

            rule Suspicious_Network_Activity {
                meta:
                    description = "Detects suspicious network activity patterns"
                    severity = "medium"
                strings:
                    $net1 = "nc -e" nocase
                    $net2 = "netcat" nocase
                    $net3 = "/dev/tcp/" nocase
                    $net4 = "socket.connect" nocase
                condition:
                    any of ($net*)
            }

            rule Obfuscation_Patterns {
                meta:
                    description = "Detects common obfuscation patterns"
                    severity = "medium"
                strings:
                    $obf1 = "base64" nocase
                    $obf2 = { 5C 78 }
                    $obf3 = "chr(" nocase
                    $obf4 = "fromCharCode" nocase
                condition:
                    2 of ($obf*)
            }
            """

            # Compile YARA rules
            self.rules = yara_module.compile(source=rules_source)
            logger.debug("Initialized YARA detector with built-in rules")

        except MissingDependencyError:
            raise
        except Exception as e:
            logger.error(f"Failed to initialize YARA detector: {e}")
            raise

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

            # Scan with YARA rules
            matches = self.rules.match(data=content_bytes)

            # Process each match
            for match in matches:
                # Get metadata
                severity_str = match.meta.get("severity", "medium")
                description = match.meta.get("description", match.rule)

                # Determine severity
                severity = self._parse_severity(severity_str)

                # Get matched strings (YARA 4.x format)
                matched_strings = []
                for string_match in match.strings:
                    # In YARA 4.x, string_match has: identifier, instances
                    # instances is a list of (offset, instance_data, matched_data) tuples
                    for instance in string_match.instances:
                        matched_strings.append(
                            instance.matched_data.decode("utf-8", errors="ignore")
                        )

                # Calculate confidence based on number of matches
                confidence = min(0.7 + (len(matched_strings) * 0.05), 0.99)

                # Apply confidence threshold
                if confidence < (self.config.confidence_threshold or 0.7):
                    continue

                # Create detection result
                result = DetectionResult(
                    detector_type=DetectorType.YARA,
                    finding_type=match.rule,
                    category="THREAT",
                    severity=severity,
                    confidence=confidence,
                    matched_content=", ".join(matched_strings[:3]),  # Show first 3 matches
                    location=Location(
                        path=f"yara:{content_type}",
                        description=f"matched rule {match.rule}",
                    ),
                    metadata={
                        "description": description,
                        "match_count": len(match.strings),
                        "rule_name": match.rule,
                    },
                )

                results.append(result)

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

    def _parse_severity(self, severity_str: str) -> Severity:
        """
        Parse severity string to Severity enum.

        Args:
            severity_str: Severity as string

        Returns:
            Severity enum value
        """
        severity_map = {
            "critical": Severity.critical,
            "high": Severity.high,
            "medium": Severity.medium,
            "low": Severity.low,
            "info": Severity.info,
        }

        return severity_map.get(severity_str.lower(), Severity.medium)
