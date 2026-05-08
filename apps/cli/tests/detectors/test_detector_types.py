"""Test that all detector types match the schema."""

import pytest

from src.detectors.broken_links.detector import BrokenLinksDetector
from src.detectors.content.feature_extraction_detector import FeatureExtractionDetector
from src.detectors.content.image_classification_detector import ImageClassificationDetector
from src.detectors.content.language_detector import LanguageDetector
from src.detectors.content.object_detection_detector import ObjectDetectionDetector
from src.detectors.content.text_classification_detector import TextClassificationDetector
from src.detectors.content.toxic_detector import ToxicDetector
from src.detectors.custom.detector import CustomDetector
from src.detectors.dependencies import MissingDependencyError
from src.detectors.pii.detector import PIIDetector
from src.detectors.secrets.detector import SecretsDetector
from src.detectors.threat.code_security_detector import CodeSecurityDetector
from src.detectors.threat.yara_detector import YaraDetector
from src.models.generated_detectors import (
    BrokenLinksDetectorConfig,
    ContentDetectorConfig,
    CustomDetectorConfig,
    DetectorConfig,
    DetectorType,
    FeatureExtractionDetectorConfig,
    ObjectDetectionDetectorConfig,
    PIIDetectorConfig,
    RegexPatternDefinition,
    RegexPipelineSchema,
    SecretsDetectorConfig,
    TextClassificationDetectorConfig,
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

    def test_image_classification_detector_type(self):
        """Test ImageClassificationDetector has correct detector_type."""
        try:
            from src.models.generated_detectors import ImageClassificationDetectorConfig

            detector = ImageClassificationDetector(ImageClassificationDetectorConfig())
            assert detector.detector_type == "image_classification"
            assert DetectorType(detector.detector_type.upper()) == DetectorType.IMAGE_CLASSIFICATION
            assert (
                ScanResultDetectorType(detector.detector_type.upper())
                == ScanResultDetectorType.IMAGE_CLASSIFICATION
            )
        except MissingDependencyError:
            pytest.skip("PyTorch not installed, skipping image_classification detector test")

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

    def test_text_classification_detector_type(self):
        """Test TextClassificationDetector has correct detector_type."""
        try:
            from src.models.generated_detectors import TextClassificationDetectorConfig

            config = TextClassificationDetectorConfig(
                model="mrm8488/bert-tiny-finetuned-sms-spam-detection"
            )
            detector = TextClassificationDetector(config)
            assert detector.detector_type == "text_classification"
            assert DetectorType(detector.detector_type.upper()) == DetectorType.TEXT_CLASSIFICATION
            assert (
                ScanResultDetectorType(detector.detector_type.upper())
                == ScanResultDetectorType.TEXT_CLASSIFICATION
            )
        except MissingDependencyError:
            pytest.skip("transformers/torch not installed, skipping text_classification test")

    def test_feature_extraction_detector_type(self) -> None:
        """Test FeatureExtractionDetector has correct detector_type."""
        try:
            config = FeatureExtractionDetectorConfig(model="BAAI/bge-base-en-v1.5")
            detector = FeatureExtractionDetector(config)
            assert detector.detector_type == "feature_extraction"
            assert DetectorType(detector.detector_type.upper()) == DetectorType.FEATURE_EXTRACTION
            assert (
                ScanResultDetectorType(detector.detector_type.upper())
                == ScanResultDetectorType.FEATURE_EXTRACTION
            )
        except MissingDependencyError:
            pytest.skip("transformers/torch not installed, skipping feature_extraction test")

    def test_object_detection_detector_type(self) -> None:
        """Test ObjectDetectionDetector has correct detector_type."""
        try:
            config = ObjectDetectionDetectorConfig(model="facebook/detr-resnet-50")
            detector = ObjectDetectionDetector(config)
            assert detector.detector_type == "object_detection"
            assert DetectorType(detector.detector_type.upper()) == DetectorType.OBJECT_DETECTION
            assert (
                ScanResultDetectorType(detector.detector_type.upper())
                == ScanResultDetectorType.OBJECT_DETECTION
            )
        except MissingDependencyError:
            pytest.skip("transformers/torch not installed, skipping object_detection test")

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
            (ImageClassificationDetector, None),
            (YaraDetector, ThreatDetectorConfig()),
            (BrokenLinksDetector, BrokenLinksDetectorConfig()),
            (
                TextClassificationDetector,
                TextClassificationDetectorConfig(
                    model="mrm8488/bert-tiny-finetuned-sms-spam-detection"
                ),
            ),
            (
                FeatureExtractionDetector,
                FeatureExtractionDetectorConfig(model="BAAI/bge-base-en-v1.5"),
            ),
            (
                ObjectDetectionDetector,
                ObjectDetectionDetectorConfig(model="facebook/detr-resnet-50"),
            ),
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
            "IMAGE_CLASSIFICATION",
            "TEXT_CLASSIFICATION",
            "FEATURE_EXTRACTION",
            "OBJECT_DETECTION",
            "YARA",
            "BROKEN_LINKS",
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

    def test_image_classification_uses_its_config(self):
        """Test ImageClassificationDetector accepts ImageClassificationDetectorConfig."""
        try:
            from src.models.generated_detectors import ImageClassificationDetectorConfig

            config = ImageClassificationDetectorConfig(
                model="google/vit-base-patch16-224",
                device="cpu",
                confidence_threshold=0.8,
            )
            detector = ImageClassificationDetector(config)
            assert detector.config == config
        except MissingDependencyError:
            pytest.skip("PyTorch not installed, skipping image_classification test")

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
            (ImageClassificationDetector, None, "image_classification"),
            (YaraDetector, ThreatDetectorConfig(), "yara"),
            (BrokenLinksDetector, BrokenLinksDetectorConfig(), "broken_links"),
            (
                TextClassificationDetector,
                TextClassificationDetectorConfig(
                    model="mrm8488/bert-tiny-finetuned-sms-spam-detection"
                ),
                "text_classification",
            ),
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
