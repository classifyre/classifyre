"""Code security detector using Bandit static analysis."""

import json
import logging
import subprocess
import sys
import tempfile
from importlib.util import find_spec
from pathlib import Path
from typing import Any

from ...models.generated_detectors import DetectorConfig, Severity
from ...models.generated_single_asset_scan_results import (
    DetectionResult,
    DetectorType,
)
from ..base import BaseDetector
from ..dependencies import MissingDependencyError, require_module

logger = logging.getLogger(__name__)


class CodeSecurityDetector(BaseDetector):
    """Detect insecure code patterns with Bandit (rule-based)."""

    detector_type = "code_security"
    detector_name = "code_security"

    def __init__(self, config: DetectorConfig | None = None):
        super().__init__(config)
        # Importing `bandit` eagerly can trigger stevedore plugin discovery noise.
        # We only verify Bandit availability here; execution happens in a subprocess.
        if find_spec("bandit") is None:
            try:
                require_module("bandit", "code_security", ["security", "detectors"])
            except MissingDependencyError:
                raise

    @staticmethod
    def _severity_from_bandit(level: str) -> Severity:
        normalized = level.upper()
        if normalized == "HIGH":
            return Severity.high
        if normalized == "MEDIUM":
            return Severity.medium
        if normalized == "LOW":
            return Severity.low
        return Severity.info

    @staticmethod
    def _confidence_from_bandit(level: str) -> float:
        normalized = level.upper()
        if normalized == "HIGH":
            return 0.95
        if normalized == "MEDIUM":
            return 0.8
        if normalized == "LOW":
            return 0.6
        return 0.5

    def _run_bandit_json(self, content: str) -> tuple[list[dict[str, Any]], list[str]]:
        with tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".py",
            encoding="utf-8",
            delete=False,
        ) as handle:
            handle.write(content)
            tmp_path = Path(handle.name)

        try:
            proc = subprocess.run(
                [sys.executable, "-m", "bandit", "-q", "-f", "json", str(tmp_path)],
                capture_output=True,
                text=True,
                check=False,
            )

            if proc.returncode not in (0, 1):
                stderr = proc.stderr.strip() or "Unknown Bandit execution error"
                logger.error(f"Bandit execution failed: {stderr}")
                return [], [stderr]

            stdout = proc.stdout.strip() or "{}"
            payload = json.loads(stdout)
            if not isinstance(payload, dict):
                return [], []

            results = payload.get("results", [])
            errors = payload.get("errors", [])
            return (
                [item for item in results if isinstance(item, dict)],
                [str(item) for item in errors],
            )
        except Exception as exc:
            logger.error(f"Code security scan failed: {exc}")
            return [], [str(exc)]
        finally:
            tmp_path.unlink(missing_ok=True)

    async def detect(self, content: str, content_type: str = "text/plain") -> list[DetectionResult]:
        if not content.strip():
            return []

        threshold = self.config.confidence_threshold or 0.7
        max_findings = self.config.max_findings or 25
        findings: list[DetectionResult] = []

        issues, errors = self._run_bandit_json(content)
        if not issues:
            if errors:
                logger.debug(f"Bandit returned no issues with errors: {errors}")
            return []

        for issue in issues:
            confidence = self._confidence_from_bandit(str(issue.get("issue_confidence", "")))
            if confidence < threshold:
                continue

            issue_text = str(issue.get("issue_text", "Potential insecure code pattern"))
            code_snippet = str(issue.get("code", "")).strip()
            finding_type = str(issue.get("test_id", issue.get("test_name", "code_security")))

            findings.append(
                DetectionResult(
                    detector_type=DetectorType.CODE_SECURITY,
                    finding_type=finding_type,
                    category="SECURITY",
                    severity=self._severity_from_bandit(str(issue.get("issue_severity", ""))),
                    confidence=confidence,
                    matched_content=code_snippet or issue_text,
                    location=None,
                    metadata={
                        "tool": "bandit",
                        "issue_text": issue_text,
                        "test_name": issue.get("test_name"),
                        "test_id": issue.get("test_id"),
                        "issue_severity": issue.get("issue_severity"),
                        "issue_confidence": issue.get("issue_confidence"),
                    },
                )
            )

            if len(findings) >= max_findings:
                break

        return findings

    def get_supported_content_types(self) -> list[str]:
        return [
            "text/plain",
            "text/html",
            "text/markdown",
            "application/json",
            "application/octet-stream",
        ]
