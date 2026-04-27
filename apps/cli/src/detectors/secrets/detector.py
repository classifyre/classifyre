"""Secrets detector powered by the detect-secrets library."""

import logging
import os
import tempfile
from typing import Any

from ...models.generated_detectors import DetectorConfig, Severity
from ...models.generated_single_asset_scan_results import DetectionResult, DetectorType, Location
from ..base import BaseDetector
from ..dependencies import MissingDependencyError, require_module

logger = logging.getLogger(__name__)

# Maps SecretsEnabledPattern enum values → detect-secrets plugin class names.
_PATTERN_TO_PLUGIN: dict[str, str] = {
    "artifactory": "ArtifactoryDetector",
    "aws": "AWSKeyDetector",
    "azure_storage": "AzureStorageKeyDetector",
    "basic_auth": "BasicAuthDetector",
    "cloudant": "CloudantDetector",
    "discord": "DiscordBotTokenDetector",
    "github": "GitHubTokenDetector",
    "gitlab": "GitLabTokenDetector",
    "high_entropy_base64": "Base64HighEntropyString",
    "high_entropy_hex": "HexHighEntropyString",
    "ibm_cloud_iam": "IbmCloudIamDetector",
    "ibm_cos_hmac": "IbmCosHmacDetector",
    "ip_public": "IPPublicDetector",
    "jwt": "JwtTokenDetector",
    "keyword": "KeywordDetector",
    "mailchimp": "MailchimpDetector",
    "npm": "NpmDetector",
    "openai": "OpenAIDetector",
    "private_key": "PrivateKeyDetector",
    "pypi": "PypiTokenDetector",
    "sendgrid": "SendGridDetector",
    "slack": "SlackDetector",
    "softlayer": "SoftlayerDetector",
    "square_oauth": "SquareOAuthDetector",
    "stripe": "StripeDetector",
    "telegram": "TelegramBotTokenDetector",
    "twilio": "TwilioKeyDetector",
}

_ALL_PATTERNS = list(_PATTERN_TO_PLUGIN.keys())

# Severity classification by keywords in detect-secrets finding type (lowercased).
# Rules are evaluated in order; first match wins.
_SEVERITY_RULES: list[tuple[Severity, list[str]]] = [
    (
        Severity.critical,
        [
            "aws", "private key", "github", "gitlab",
            "slack", "stripe", "azure storage", "google oauth", "openai",
        ],
    ),
    (
        Severity.high,
        [
            "artifactory", "basic auth", "cloudant", "discord",
            "ibm", "json web token", "mailchimp", "npm",
            "pypi", "sendgrid", "softlayer", "square", "telegram", "twilio",
        ],
    ),
    (
        Severity.medium,
        ["entropy", "keyword", "ip public"],
    ),
]

# Confidence by keywords in detect-secrets finding type (lowercased).
# Rules are evaluated in order; first match wins.
_CONFIDENCE_RULES: list[tuple[float, list[str]]] = [
    (
        0.95,
        [
            "aws", "github", "gitlab", "private key", "slack",
            "stripe", "azure storage", "openai", "pypi",
        ],
    ),
    (0.85, ["artifactory", "basic auth", "cloudant", "discord", "ibm", "mailchimp",
            "npm", "sendgrid", "softlayer", "square", "telegram", "twilio"]),
    (0.80, ["json web token"]),
    (0.75, ["entropy"]),
    (0.70, ["keyword", "ip public"]),
]


class SecretsDetector(BaseDetector):
    """Secrets detector backed by the detect-secrets library.

    Uses detect-secrets' plugin system via transient_settings so plugin
    selection is entirely config-driven with no regex or keyword logic of
    our own.  All secret-pattern matching is delegated to the upstream library.
    """

    detector_type = "secrets"
    detector_name = "secrets"

    def __init__(self, config: DetectorConfig | None = None):
        super().__init__(config)
        # Fail fast at construction time if detect-secrets is not installed.
        try:
            require_module("detect_secrets", "secrets", ["security", "detectors"])
        except MissingDependencyError:
            raise

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _build_plugins_used(self) -> list[dict[str, Any]]:
        """Build the plugins_used list consumed by detect-secrets transient_settings."""
        patterns = self.config.enabled_patterns
        active_patterns: list[str] = (
            _ALL_PATTERNS if patterns is None
            else [p for p in patterns if p in _PATTERN_TO_PLUGIN]
        )

        plugins: list[dict[str, Any]] = []
        for pattern in active_patterns:
            entry: dict[str, Any] = {"name": _PATTERN_TO_PLUGIN[pattern]}

            # Entropy plugins accept an optional limit override.
            if pattern == "high_entropy_base64":
                limit = getattr(self.config, "entropy_limit_base64", None)
                if limit is not None:
                    entry["limit"] = float(limit)
            elif pattern == "high_entropy_hex":
                limit = getattr(self.config, "entropy_limit_hex", None)
                if limit is not None:
                    entry["limit"] = float(limit)

            plugins.append(entry)

        return plugins

    @staticmethod
    def _line_start_offsets(lines: list[str]) -> list[int]:
        """Return the cumulative character offset of the first char of each line."""
        offsets: list[int] = []
        pos = 0
        for line in lines:
            offsets.append(pos)
            pos += len(line) + 1  # +1 for the newline stripped by splitlines()
        return offsets

    @classmethod
    def _get_severity(cls, secret_type: str) -> Severity:
        t = secret_type.lower()
        for severity, keywords in _SEVERITY_RULES:
            if any(kw in t for kw in keywords):
                return severity
        return Severity.high

    @classmethod
    def _get_confidence(cls, secret_type: str) -> float:
        t = secret_type.lower()
        for confidence, keywords in _CONFIDENCE_RULES:
            if any(kw in t for kw in keywords):
                return confidence
        return 0.85

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def detect(
        self, content: str, content_type: str = "text/plain"
    ) -> list[DetectionResult]:
        try:
            from detect_secrets import SecretsCollection
            from detect_secrets.settings import transient_settings
        except ImportError as exc:
            raise MissingDependencyError("detect_secrets", "secrets") from exc

        plugins_used = self._build_plugins_used()
        if not plugins_used:
            return []

        lines = content.splitlines()
        line_offsets = self._line_start_offsets(lines)
        confidence_threshold: float = self.config.confidence_threshold or 0.7
        results: list[DetectionResult] = []

        # detect-secrets operates on files; write content to a named temp file
        # so the library can use its normal scanning path.
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".txt")
        try:
            with os.fdopen(tmp_fd, "w", encoding="utf-8") as fh:
                fh.write(content)

            collection = SecretsCollection()
            with transient_settings({"plugins_used": plugins_used}):
                collection.scan_file(tmp_path)

            for _filename, secret_set in collection:
                for secret in secret_set:
                    confidence = self._get_confidence(secret.type)
                    if confidence < confidence_threshold:
                        continue

                    line_idx = (secret.line_number or 1) - 1
                    line_text = lines[line_idx] if 0 <= line_idx < len(lines) else ""
                    line_start = line_offsets[line_idx] if line_idx < len(line_offsets) else 0

                    # secret_value is the raw secret; fall back to the trimmed line.
                    raw_value: str = secret.secret_value or line_text.strip()

                    col_offset = line_text.find(raw_value) if raw_value in line_text else 0
                    start = line_start + col_offset
                    end = start + len(raw_value)

                    results.append(
                        DetectionResult(
                            detector_type=DetectorType.SECRETS,
                            finding_type=secret.type,
                            category="SECRETS",
                            severity=self._get_severity(secret.type),
                            confidence=confidence,
                            matched_content=raw_value,
                            location=Location(
                                start=start,
                                end=end,
                                line=secret.line_number,
                                path=f"line {secret.line_number}",
                            ),
                            metadata={
                                "plugin": secret.type,
                                "is_verified": secret.is_verified,
                            },
                        )
                    )

        except Exception as exc:
            logger.error("Error scanning for secrets: %s", exc)
            logger.exception(exc)
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

        if self.config.max_findings and len(results) > self.config.max_findings:
            results = results[: self.config.max_findings]

        return results

    def get_supported_content_types(self) -> list[str]:
        return [
            "text/plain",
            "application/json",
            "application/yaml",
            "application/x-yaml",
            "text/yaml",
            "application/xml",
            "text/xml",
        ]
