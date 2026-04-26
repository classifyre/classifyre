"""Test that all detector types match the schema."""

import pytest

from src.detectors.broken_links.detector import BrokenLinksDetector
from src.detectors.content.language_detector import LanguageDetector
from src.detectors.content.nsfw_detector import NSFWDetector
from src.detectors.content.spam_detector import SpamDetector
from src.detectors.content.toxic_detector import ToxicDetector
from src.detectors.custom.detector import CustomDetector
from src.detectors.dependencies import MissingDependencyError
from src.detectors.pii.detector import PIIDetector
from src.detectors.secrets.detector import SecretsDetector
from src.detectors.threat.code_security_detector import CodeSecurityDetector
from src.detectors.threat.prompt_injection_detector import PromptInjectionDetector
from src.detectors.threat.yara_detector import YaraDetector
from src.models.generated_detectors import (
    BrokenLinksDetectorConfig,
    ContentDetectorConfig,
    CustomDetectorConfig,
    DetectorConfig,
    DetectorType,
    PIIDetectorConfig,
    RegexPatternDefinition,
    RegexPipelineSchema,
    SecretsDetectorConfig,
    ThreatDetectorConfig,
)
from src.models.generated_single_asset_scan_results import (
    DetectorType as ScanResultDetectorType,
)


class TestDetectorTypesMatchSchema:
    """Test that detector_type class attributes match the schema enum."""

    def test_secrets_detector_type(self):
        """Test SecretsDetector has correct detector_type."""
        try:
            detector = SecretsDetector(SecretsDetectorConfig())
            assert detector.detector_type == "secrets"
            # Verify it can be converted to DetectorType enum
            assert DetectorType(detector.detector_type.upper()) == DetectorType.SECRETS
            assert (
                ScanResultDetectorType(detector.detector_type.upper())
                == ScanResultDetectorType.SECRETS
            )
        except MissingDependencyError:
            pytest.skip("detect-secrets not installed, skipping secrets detector test")

    def test_pii_detector_type(self):
        """Test PIIDetector has correct detector_type."""
        try:
            detector = PIIDetector(PIIDetectorConfig())
            assert detector.detector_type == "pii"
            # Verify it can be converted to DetectorType enum
            assert DetectorType(detector.detector_type.upper()) == DetectorType.PII
            assert (
                ScanResultDetectorType(detector.detector_type.upper()) == ScanResultDetectorType.PII
            )
        except MissingDependencyError:
            pytest.skip("Presidio not installed, skipping PII detector test")

    def test_toxic_detector_type(self):
        """Test ToxicDetector has correct detector_type."""
        try:
            detector = ToxicDetector(ContentDetectorConfig())
            assert detector.detector_type == "toxic"
            # Verify it can be converted to DetectorType enum
            assert DetectorType(detector.detector_type.upper()) == DetectorType.TOXIC
            assert (
                ScanResultDetectorType(detector.detector_type.upper())
                == ScanResultDetectorType.TOXIC
            )
        except MissingDependencyError:
            pytest.skip("PyTorch not installed, skipping toxic detector test")

    def test_nsfw_detector_type(self):
        """Test NSFWDetector has correct detector_type."""
        try:
            detector = NSFWDetector(ContentDetectorConfig())
            assert detector.detector_type == "nsfw"
            # Verify it can be converted to DetectorType enum
            assert DetectorType(detector.detector_type.upper()) == DetectorType.NSFW
            assert (
                ScanResultDetectorType(detector.detector_type.upper())
                == ScanResultDetectorType.NSFW
            )
        except MissingDependencyError:
            pytest.skip("PyTorch not installed, skipping nsfw detector test")

    def test_yara_detector_type(self):
        """Test YaraDetector has correct detector_type."""
        try:
            detector = YaraDetector(ThreatDetectorConfig())
            assert detector.detector_type == "yara"
            # Verify it can be converted to DetectorType enum
            assert DetectorType(detector.detector_type.upper()) == DetectorType.YARA
            assert (
                ScanResultDetectorType(detector.detector_type.upper())
                == ScanResultDetectorType.YARA
            )
        except MissingDependencyError:
            pytest.skip("YARA not installed, skipping yara detector test")

    def test_broken_links_detector_type(self):
        """Test BrokenLinksDetector has correct detector_type."""
        detector = BrokenLinksDetector(BrokenLinksDetectorConfig())
        assert detector.detector_type == "broken_links"
        assert DetectorType(detector.detector_type.upper()) == DetectorType.BROKEN_LINKS
        assert (
            ScanResultDetectorType(detector.detector_type.upper())
            == ScanResultDetectorType.BROKEN_LINKS
        )

    def test_custom_detector_type(self):
        """Test CustomDetector has correct detector_type."""
        detector = CustomDetector(
            CustomDetectorConfig(
                custom_detector_key="cust_test_rules",
                name="Test Custom Rules",
                pipeline_schema=RegexPipelineSchema(
                    patterns={"x": RegexPatternDefinition(pattern=r"\d+")}
                ),
            )
        )
        assert detector.detector_type == "custom"
        assert DetectorType(detector.detector_type.upper()) == DetectorType.CUSTOM
        assert (
            ScanResultDetectorType(detector.detector_type.upper()) == ScanResultDetectorType.CUSTOM
        )

    def test_prompt_injection_detector_type(self):
        """Test PromptInjectionDetector has correct detector_type."""
        try:
            detector = PromptInjectionDetector()
            assert detector.detector_type == "prompt_injection"
            assert DetectorType(detector.detector_type.upper()) == DetectorType.PROMPT_INJECTION
            assert (
                ScanResultDetectorType(detector.detector_type.upper())
                == ScanResultDetectorType.PROMPT_INJECTION
            )
        except MissingDependencyError:
            pytest.skip("transformers/torch not installed, skipping prompt injection test")

    def test_spam_detector_type(self):
        """Test SpamDetector has correct detector_type."""
        try:
            detector = SpamDetector()
            assert detector.detector_type == "spam"
            assert DetectorType(detector.detector_type.upper()) == DetectorType.SPAM
            assert (
                ScanResultDetectorType(detector.detector_type.upper())
                == ScanResultDetectorType.SPAM
            )
        except MissingDependencyError:
            pytest.skip("transformers/torch not installed, skipping spam test")

    def test_language_detector_type(self):
        """Test LanguageDetector has correct detector_type."""
        try:
            detector = LanguageDetector()
            assert detector.detector_type == "language"
            assert DetectorType(detector.detector_type.upper()) == DetectorType.LANGUAGE
            assert (
                ScanResultDetectorType(detector.detector_type.upper())
                == ScanResultDetectorType.LANGUAGE
            )
        except MissingDependencyError:
            pytest.skip("fast-langdetect not installed, skipping language test")

    def test_code_security_detector_type(self):
        """Test CodeSecurityDetector has correct detector_type."""
        try:
            detector = CodeSecurityDetector()
            assert detector.detector_type == "code_security"
            assert DetectorType(detector.detector_type.upper()) == DetectorType.CODE_SECURITY
            assert (
                ScanResultDetectorType(detector.detector_type.upper())
                == ScanResultDetectorType.CODE_SECURITY
            )
        except MissingDependencyError:
            pytest.skip("bandit not installed, skipping code security test")

    def test_all_detector_types_are_valid_enums(self):
        """Test that all detector_type values are valid DetectorType enums."""
        detectors = [
            (SecretsDetector, SecretsDetectorConfig()),
            (PIIDetector, PIIDetectorConfig()),
            (ToxicDetector, ContentDetectorConfig()),
            (NSFWDetector, ContentDetectorConfig()),
            (YaraDetector, ThreatDetectorConfig()),
            (BrokenLinksDetector, BrokenLinksDetectorConfig()),
            (PromptInjectionDetector, None),
            (SpamDetector, None),
            (LanguageDetector, None),
            (CodeSecurityDetector, None),
        ]

        for detector_class, config in detectors:
            try:
                detector = detector_class(config) if config is not None else detector_class()
                # This should not raise an exception
                detector_type_upper = detector.detector_type.upper()
                _ = DetectorType(detector_type_upper)
                _ = ScanResultDetectorType(detector_type_upper)
            except MissingDependencyError:
                # Skip detectors that require missing dependencies
                continue

    def test_invalid_detector_type_raises_error(self):
        """Test that invalid detector types raise ValueError."""
        with pytest.raises(ValueError, match="is not a valid DetectorType"):
            DetectorType("INVALID")

        with pytest.raises(ValueError, match="is not a valid DetectorType"):
            DetectorType("THREAT")  # Common mistake

        with pytest.raises(ValueError, match="is not a valid DetectorType"):
            DetectorType("CONTENT")  # Common mistake

    def test_detector_type_enum_values(self):
        """Test that all expected DetectorType enum values exist."""
        expected_types = {
            "SECRETS",
            "PII",
            "TOXIC",
            "NSFW",
            "YARA",
            "BROKEN_LINKS",
            "PROMPT_INJECTION",
            "SPAM",
            "LANGUAGE",
            "CODE_SECURITY",
            "CUSTOM",
        }
        actual_types = {dt.value for dt in DetectorType}
        assert actual_types == expected_types, (
            f"DetectorType enum mismatch. Expected: {expected_types}, Actual: {actual_types}"
        )

    def test_scan_result_detector_type_enum_values(self):
        """Test that ScanResultDetectorType enum matches DetectorType."""
        detector_type_values = {dt.value for dt in DetectorType}
        scan_result_type_values = {dt.value for dt in ScanResultDetectorType}
        assert detector_type_values == scan_result_type_values, (
            f"DetectorType and ScanResultDetectorType enums should match. "
            f"DetectorType: {detector_type_values}, "
            f"ScanResultDetectorType: {scan_result_type_values}"
        )


class TestDetectorConfigMapping:
    """Test that detector types map correctly to config classes."""

    def test_secrets_uses_secrets_config(self):
        """Test SecretsDetector accepts SecretsDetectorConfig."""
        try:
            config = SecretsDetectorConfig(
                enabled_patterns=["aws", "github"], confidence_threshold=0.8
            )
            detector = SecretsDetector(config)
            assert detector.config == config
        except MissingDependencyError:
            pytest.skip("detect-secrets not installed, skipping secrets config test")

    def test_pii_uses_pii_config(self):
        """Test PIIDetector accepts PIIDetectorConfig."""
        try:
            config = PIIDetectorConfig(
                enabled_patterns=["EMAIL_ADDRESS", "PHONE_NUMBER"], confidence_threshold=0.75
            )
            detector = PIIDetector(config)
            assert detector.config == config
        except MissingDependencyError:
            pytest.skip("Presidio not installed, skipping PII config test")

    def test_toxic_uses_content_config(self):
        """Test ToxicDetector accepts ContentDetectorConfig."""
        try:
            config = ContentDetectorConfig(
                enabled_patterns=["toxicity", "threat"],
                model_name="unbiased",
                confidence_threshold=0.7,
            )
            detector = ToxicDetector(config)
            assert detector.config == config
        except MissingDependencyError:
            pytest.skip("PyTorch not installed, skipping toxic detector test")

    def test_nsfw_uses_content_config(self):
        """Test NSFWDetector accepts ContentDetectorConfig."""
        try:
            config = ContentDetectorConfig(
                enabled_patterns=["nsfw", "nsfw_explicit"],
                model_name="original",
                confidence_threshold=0.8,
            )
            detector = NSFWDetector(config)
            assert detector.config == config
        except MissingDependencyError:
            pytest.skip("PyTorch not installed, skipping nsfw detector test")

    def test_yara_uses_threat_config(self):
        """Test YaraDetector accepts ThreatDetectorConfig."""
        try:
            config = ThreatDetectorConfig(timeout=90, max_findings=500)
            detector = YaraDetector(config)
            assert detector.config == config
        except MissingDependencyError:
            pytest.skip("YARA not installed, skipping yara config test")

    def test_broken_links_uses_broken_links_config(self):
        """Test BrokenLinksDetector accepts BrokenLinksDetectorConfig."""
        config = BrokenLinksDetectorConfig()
        detector = BrokenLinksDetector(config)
        assert detector.config is not None

    def test_custom_uses_custom_config(self):
        """Test CustomDetector accepts CustomDetectorConfig."""
        config = CustomDetectorConfig(
            custom_detector_key="cust_test_classifier",
            name="Test Custom Classifier",
            pipeline_schema=RegexPipelineSchema(
                patterns={"x": RegexPatternDefinition(pattern=r"\d+")}
            ),
        )
        detector = CustomDetector(config)
        assert detector.config == config


class TestDetectorNames:
    """Test that detector names are consistent."""

    def test_detector_names_match_types(self):
        """Test that detector_name matches detector_type for all detectors."""
        detectors = [
            (SecretsDetector, SecretsDetectorConfig(), "secrets"),
            (PIIDetector, PIIDetectorConfig(), "pii"),
            (ToxicDetector, ContentDetectorConfig(), "toxic"),
            (NSFWDetector, ContentDetectorConfig(), "nsfw"),
            (YaraDetector, ThreatDetectorConfig(), "yara"),
            (BrokenLinksDetector, BrokenLinksDetectorConfig(), "broken_links"),
            (PromptInjectionDetector, DetectorConfig(), "prompt_injection"),
            (SpamDetector, DetectorConfig(), "spam"),
            (LanguageDetector, DetectorConfig(), "language"),
            (CodeSecurityDetector, DetectorConfig(), "code_security"),
            (
                CustomDetector,
                CustomDetectorConfig(
                    custom_detector_key="cust_test_names",
                    name="Custom Name Test",
                    pipeline_schema=RegexPipelineSchema(
                        patterns={"x": RegexPatternDefinition(pattern=r"\d+")}
                    ),
                ),
                "custom",
            ),
        ]

        for detector_class, config, expected_name in detectors:
            try:
                detector = detector_class(config)
                assert detector.detector_name == expected_name
                assert detector.detector_type == expected_name
                assert detector.detector_name == detector.detector_type
            except MissingDependencyError:
                # Skip detectors that require missing dependencies
                continue


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
