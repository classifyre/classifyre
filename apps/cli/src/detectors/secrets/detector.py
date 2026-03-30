"""Secrets detector using detect-secrets library."""

import logging

from ...models.generated_detectors import DetectorConfig, Severity
from ...models.generated_single_asset_scan_results import DetectionResult, DetectorType, Location
from ..base import BaseDetector
from ..dependencies import MissingDependencyError, require_module

logger = logging.getLogger(__name__)


class SecretsDetector(BaseDetector):
    """
    Detector for secrets and credentials using detect-secrets.

    Detects various types of secrets including:
    - AWS credentials
    - GitHub tokens
    - Private keys
    - Slack tokens
    - Stripe API keys
    - Generic API keys and passwords
    """

    detector_type = "secrets"
    detector_name = "secrets"

    def __init__(self, config: DetectorConfig | None = None):
        """Initialize secrets detector with detect-secrets."""
        super().__init__(config)

        try:
            util_module = require_module(
                "detect_secrets.core.plugins.util",
                "secrets",
                ["security", "detectors"],
            )
            get_mapping_from_secret_type_to_class = (
                util_module.get_mapping_from_secret_type_to_class
            )

            # Initialize plugins
            all_plugins = get_mapping_from_secret_type_to_class()
        except MissingDependencyError:
            raise

        # Only enable high-confidence, specific plugins (not generic entropy-based ones)
        # This reduces false positives significantly
        preferred_plugins = [
            "AWSKeyDetector",
            "PrivateKeyDetector",
            "SlackDetector",
            "StripeDetector",
            "GitHubTokenDetector",
            "ArtifactoryDetector",
            "AzureStorageKeyDetector",
            "BasicAuthDetector",
            "CloudantDetector",
            "DiscordBotTokenDetector",
            "GitLabTokenDetector",
            "GoogleApiKeyDetector",
            "IBMCloudIamDetector",
            "IBMCosHmacDetector",
            "IPPublicDetector",
            "JwtTokenDetector",
            "MailchimpDetector",
            "NpmDetector",
            "SendGridDetector",
            "SoftlayerDetector",
            "SquareOAuthDetector",
            "TwilioKeyDetector",
        ]

        # Create enabled plugins list
        self._enabled_plugins = []
        for plugin_class in all_plugins.values():
            # Only enable specific, high-confidence plugins
            if plugin_class.__name__ in preferred_plugins:
                try:
                    self._enabled_plugins.append(plugin_class())  # type: ignore[misc]
                    logger.debug(f"Enabled plugin: {plugin_class.__name__}")
                except Exception as e:
                    logger.warning(f"Failed to initialize plugin {plugin_class.__name__}: {e}")

    async def detect(self, content: str, content_type: str = "text/plain") -> list[DetectionResult]:
        """
        Detect secrets in content using detect-secrets.

        Args:
            content: Text content to scan
            content_type: MIME type (must be text-based)

        Returns:
            List of detection results for found secrets
        """
        results: list[DetectionResult] = []

        try:
            # Scan content line by line with all plugins
            lines = content.split("\n")

            for line_num, line in enumerate(lines, 1):
                # Skip empty lines
                if not line.strip():
                    continue

                # Scan with each plugin
                for plugin in self._enabled_plugins:
                    try:
                        # Analyze the line with the plugin
                        plugin_results = plugin.analyze_line(
                            filename="<string>",
                            line=line,
                            line_number=line_num,
                        )

                        # Process results from this plugin
                        for secret in plugin_results:
                            # Calculate character offset in the full content
                            offset = sum(len(lines[i]) + 1 for i in range(line_num - 1))

                            # Extract the matched content
                            # Try to get the actual secret value
                            matched_content = line.strip()

                            # Try to extract just the secret value if there's an = sign
                            if "=" in line:
                                parts = line.split("=", 1)
                                if len(parts) == 2:
                                    matched_content = parts[1].strip().strip('"').strip("'")

                            # Calculate start/end positions
                            start = offset
                            if matched_content in line:
                                start = offset + line.find(matched_content)
                            end = start + len(matched_content)

                            # Determine severity based on secret type
                            severity = self._get_severity_for_type(secret.type)

                            # Create detection result
                            result = DetectionResult(
                                detector_type=DetectorType.SECRETS,
                                finding_type=secret.type,
                                category="SECRETS",
                                severity=severity,
                                confidence=self._calculate_confidence(secret.type),
                                matched_content=matched_content,
                                location=Location(
                                    path=f"line {line_num}",
                                    description=f"character range {start}-{end}",
                                ),
                                metadata={
                                    "detector": secret.type,
                                    "plugin": plugin.__class__.__name__,
                                },
                            )

                            # Apply confidence threshold
                            if result.confidence >= (self.config.confidence_threshold or 0.7):
                                results.append(result)

                    except Exception as e:
                        # Log but continue with other plugins
                        logger.debug(
                            f"Plugin {plugin.__class__.__name__} failed on line {line_num}: {e}"
                        )
                        continue

        except Exception as e:
            logger.error(f"Error scanning for secrets: {e}")
            logger.exception(e)

        # Apply max_findings limit if configured
        if self.config.max_findings and len(results) > self.config.max_findings:
            results = results[: self.config.max_findings]

        return results

    def get_supported_content_types(self) -> list[str]:
        """Return supported content types for secrets detection."""
        return [
            "text/plain",
            "application/json",
            "application/yaml",
            "application/x-yaml",
            "text/yaml",
            "application/xml",
            "text/xml",
        ]

    def _get_severity_for_type(self, secret_type: str) -> Severity:
        """
        Determine severity level based on secret type.

        Args:
            secret_type: Type of secret detected

        Returns:
            Severity level
        """
        secret_type_lower = secret_type.lower()

        # Critical secrets - immediate risk
        if any(
            keyword in secret_type_lower
            for keyword in [
                "aws",
                "github",
                "private_key",
                "private key",
                "rsa",
                "ssh",
                "slack",
                "stripe",
                "google",
                "azure",
                "secret",
            ]
        ):
            return Severity.critical

        # High severity - API keys and tokens
        if any(
            keyword in secret_type_lower
            for keyword in ["api", "token", "password", "credential", "key"]
        ):
            return Severity.high

        # Medium severity - potential secrets
        if any(keyword in secret_type_lower for keyword in ["auth", "base64"]):
            return Severity.medium

        # Default to high for any detected secret
        return Severity.high

    def _calculate_confidence(self, secret_type: str) -> float:
        """
        Calculate confidence score for a detected secret.

        Args:
            secret_type: Type of secret detected

        Returns:
            Confidence score between 0 and 1
        """
        secret_type_lower = secret_type.lower()

        # High confidence for well-known patterns
        if any(
            keyword in secret_type_lower
            for keyword in [
                "aws",
                "github",
                "slack",
                "stripe",
                "private_key",
                "private key",
            ]
        ):
            return 0.95

        # Medium-high confidence for generic patterns
        if any(keyword in secret_type_lower for keyword in ["api", "token", "secret"]):
            return 0.85

        # Medium confidence for others
        return 0.75
