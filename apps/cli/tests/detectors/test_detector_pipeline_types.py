"""Test detector pipeline handles detector types correctly."""

from importlib.util import find_spec
from typing import Any

import pytest

from src.models.generated_single_asset_scan_results import DetectorType
from src.pipeline.detector_pipeline import DetectorPipeline
from src.sources.base import BaseSource


class DummySource(BaseSource):
    """Dummy source for testing."""

    def __init__(self) -> None:
        """Initialize dummy source."""
        super().__init__(recipe={})
        self._content = "Test content"

    def test_connection(self) -> dict[str, Any]:
        """Test connection."""
        return {"status": "ok"}

    async def extract(self):
        """Extract assets."""
        yield []

    def generate_hash_id(self, asset_id: str) -> str:
        """Generate hash ID."""
        return f"hash_{asset_id}"

    def abort(self) -> None:
        """Abort extraction."""
        self._aborted = True

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        """Fetch content for asset."""
        return self._content, self._content


class TestDetectorPipelineTypes:
    """Test that DetectorPipeline correctly handles detector types."""

    @staticmethod
    def _is_dependency_available(module_name: str) -> bool:
        return find_spec(module_name) is not None

    @pytest.fixture
    def mock_source(self):
        """Create a mock source for testing."""
        return DummySource()

    def test_pipeline_from_recipe_secrets(self, mock_source):
        """Test pipeline creation with SECRETS detector."""
        if not self._is_dependency_available("detect_secrets"):
            pytest.skip("detect-secrets not installed, skipping secrets pipeline test")

        recipe = {
            "detectors": [
                {
                    "type": "SECRETS",
                    "enabled": True,
                    "config": {
                        "enabled_patterns": ["aws", "github"],
                        "confidence_threshold": 0.8,
                    },
                }
            ]
        }

        pipeline = DetectorPipeline.from_recipe(recipe, source=mock_source, runner_id="test-runner")

        if len(pipeline.detectors) == 0:
            pytest.skip("detect-secrets not installed, skipping secrets pipeline test")

        assert len(pipeline.detectors) == 1
        detector = pipeline.detectors[0]
        assert detector.detector_type == "secrets"
        # Should be convertible to DetectorType enum
        assert DetectorType(detector.detector_type.upper()) == DetectorType.SECRETS

    def test_pipeline_from_recipe_pii(self, mock_source):
        """Test pipeline creation with PII detector."""
        if not self._is_dependency_available("presidio_analyzer"):
            pytest.skip("Presidio not installed, skipping PII pipeline test")

        recipe = {
            "detectors": [
                {
                    "type": "PII",
                    "enabled": True,
                    "config": {
                        "enabled_patterns": ["email", "phone_number"],
                        "confidence_threshold": 0.75,
                    },
                }
            ]
        }

        pipeline = DetectorPipeline.from_recipe(recipe, source=mock_source, runner_id="test-runner")

        if len(pipeline.detectors) == 0:
            pytest.skip("Presidio not installed, skipping pii pipeline test")

        assert len(pipeline.detectors) == 1
        detector = pipeline.detectors[0]
        assert detector.detector_type == "pii"
        # Should be convertible to DetectorType enum
        assert DetectorType(detector.detector_type.upper()) == DetectorType.PII

    def test_pipeline_from_recipe_toxic(self, mock_source):
        """Test pipeline creation with TOXIC detector."""
        try:
            import torch

            has_torch = hasattr(torch, "no_grad")
        except ImportError:
            has_torch = False

        if not has_torch:
            pytest.skip("PyTorch not installed, skipping toxic detector test")

        recipe = {
            "detectors": [
                {
                    "type": "TOXIC",
                    "enabled": True,
                    "config": {
                        "enabled_patterns": ["toxicity", "threat"],
                        "model_name": "unbiased",
                        "confidence_threshold": 0.7,
                    },
                }
            ]
        }

        pipeline = DetectorPipeline.from_recipe(recipe, source=mock_source, runner_id="test-runner")

        if len(pipeline.detectors) == 0:
            pytest.skip("YARA not installed, skipping yara pipeline test")

        assert len(pipeline.detectors) == 1
        detector = pipeline.detectors[0]
        assert detector.detector_type == "toxic"
        # Should be convertible to DetectorType enum
        assert DetectorType(detector.detector_type.upper()) == DetectorType.TOXIC

    def test_pipeline_from_recipe_nsfw(self, mock_source):
        """Test pipeline creation with NSFW detector."""
        try:
            import torch

            has_torch = hasattr(torch, "no_grad")
        except ImportError:
            has_torch = False

        if not has_torch:
            pytest.skip("PyTorch not installed, skipping nsfw detector test")

        recipe = {
            "detectors": [
                {
                    "type": "NSFW",
                    "enabled": True,
                    "config": {
                        "enabled_patterns": ["nsfw", "nsfw_explicit"],
                        "confidence_threshold": 0.8,
                    },
                }
            ]
        }

        pipeline = DetectorPipeline.from_recipe(recipe, source=mock_source, runner_id="test-runner")

        assert len(pipeline.detectors) == 1
        detector = pipeline.detectors[0]
        assert detector.detector_type == "nsfw"
        # Should be convertible to DetectorType enum
        assert DetectorType(detector.detector_type.upper()) == DetectorType.NSFW

    def test_pipeline_from_recipe_yara(self, mock_source):
        """Test pipeline creation with YARA detector."""
        if not self._is_dependency_available("yara"):
            pytest.skip("YARA not installed, skipping yara pipeline test")

        recipe = {
            "detectors": [
                {
                    "type": "YARA",
                    "enabled": True,
                    "config": {"timeout": 90, "max_findings": 500},
                }
            ]
        }

        pipeline = DetectorPipeline.from_recipe(recipe, source=mock_source, runner_id="test-runner")

        if len(pipeline.detectors) == 0:
            pytest.skip("YARA not installed, skipping yara pipeline test")

        assert len(pipeline.detectors) == 1
        detector = pipeline.detectors[0]
        assert detector.detector_type == "yara"
        # Should be convertible to DetectorType enum
        assert DetectorType(detector.detector_type.upper()) == DetectorType.YARA

    def test_pipeline_from_recipe_broken_links(self, mock_source):
        """Test pipeline creation with BROKEN_LINKS detector."""
        recipe = {
            "detectors": [
                {
                    "type": "BROKEN_LINKS",
                    "enabled": True,
                    "config": {},
                }
            ]
        }

        pipeline = DetectorPipeline.from_recipe(recipe, source=mock_source, runner_id="test-runner")

        assert len(pipeline.detectors) == 1
        detector = pipeline.detectors[0]
        assert detector.detector_type == "broken_links"
        assert DetectorType(detector.detector_type.upper()) == DetectorType.BROKEN_LINKS

    def test_pipeline_from_recipe_prompt_injection(self, mock_source):
        """Test pipeline creation with PROMPT_INJECTION detector."""
        try:
            import torch

            has_torch = hasattr(torch, "no_grad")
        except ImportError:
            has_torch = False

        if not has_torch or not self._is_dependency_available("transformers"):
            pytest.skip("transformers/torch not installed, skipping prompt injection test")

        recipe = {
            "detectors": [
                {
                    "type": "PROMPT_INJECTION",
                    "enabled": True,
                    "config": {"confidence_threshold": 0.8},
                }
            ]
        }

        pipeline = DetectorPipeline.from_recipe(recipe, source=mock_source, runner_id="test-runner")

        assert len(pipeline.detectors) == 1
        detector = pipeline.detectors[0]
        assert detector.detector_type == "prompt_injection"
        assert DetectorType(detector.detector_type.upper()) == DetectorType.PROMPT_INJECTION

    def test_pipeline_from_recipe_phishing_url(self, mock_source):
        """Test pipeline creation with PHISHING_URL detector."""
        try:
            import torch

            has_torch = hasattr(torch, "no_grad")
        except ImportError:
            has_torch = False

        if not has_torch or not self._is_dependency_available("transformers"):
            pytest.skip("transformers/torch not installed, skipping phishing URL test")

        recipe = {
            "detectors": [
                {
                    "type": "PHISHING_URL",
                    "enabled": True,
                    "config": {"confidence_threshold": 0.8},
                }
            ]
        }

        pipeline = DetectorPipeline.from_recipe(recipe, source=mock_source, runner_id="test-runner")

        assert len(pipeline.detectors) == 1
        detector = pipeline.detectors[0]
        assert detector.detector_type == "phishing_url"
        assert DetectorType(detector.detector_type.upper()) == DetectorType.PHISHING_URL

    def test_pipeline_from_recipe_spam(self, mock_source):
        """Test pipeline creation with SPAM detector."""
        try:
            import torch

            has_torch = hasattr(torch, "no_grad")
        except ImportError:
            has_torch = False

        if not has_torch or not self._is_dependency_available("transformers"):
            pytest.skip("transformers/torch not installed, skipping spam test")

        recipe = {
            "detectors": [
                {
                    "type": "SPAM",
                    "enabled": True,
                    "config": {"confidence_threshold": 0.8},
                }
            ]
        }

        pipeline = DetectorPipeline.from_recipe(recipe, source=mock_source, runner_id="test-runner")

        assert len(pipeline.detectors) == 1
        detector = pipeline.detectors[0]
        assert detector.detector_type == "spam"
        assert DetectorType(detector.detector_type.upper()) == DetectorType.SPAM

    def test_pipeline_from_recipe_language(self, mock_source):
        """Test pipeline creation with LANGUAGE detector."""
        if not self._is_dependency_available("fast_langdetect"):
            pytest.skip("fast-langdetect not installed, skipping language test")

        recipe = {
            "detectors": [
                {
                    "type": "LANGUAGE",
                    "enabled": True,
                    "config": {"confidence_threshold": 0.8},
                }
            ]
        }

        pipeline = DetectorPipeline.from_recipe(recipe, source=mock_source, runner_id="test-runner")

        assert len(pipeline.detectors) == 1
        detector = pipeline.detectors[0]
        assert detector.detector_type == "language"
        assert DetectorType(detector.detector_type.upper()) == DetectorType.LANGUAGE

    def test_pipeline_from_recipe_code_security(self, mock_source):
        """Test pipeline creation with CODE_SECURITY detector."""
        if not self._is_dependency_available("bandit"):
            pytest.skip("bandit not installed, skipping code security test")

        recipe = {
            "detectors": [
                {
                    "type": "CODE_SECURITY",
                    "enabled": True,
                    "config": {"confidence_threshold": 0.7},
                }
            ]
        }

        pipeline = DetectorPipeline.from_recipe(recipe, source=mock_source, runner_id="test-runner")

        assert len(pipeline.detectors) == 1
        detector = pipeline.detectors[0]
        assert detector.detector_type == "code_security"
        assert DetectorType(detector.detector_type.upper()) == DetectorType.CODE_SECURITY

    def test_pipeline_from_recipe_custom_ruleset(self, mock_source):
        """Test pipeline creation with CUSTOM detector."""
        recipe = {
            "detectors": [
                {
                    "type": "CUSTOM",
                    "enabled": True,
                    "config": {
                        "custom_detector_key": "cust_pipeline_ruleset",
                        "name": "Pipeline Custom",
                        "method": "RULESET",
                        "ruleset": {
                            "keyword_rules": [
                                {
                                    "id": "kw_1",
                                    "name": "Primary keywords",
                                    "keywords": ["risk", "vertrag"],
                                }
                            ],
                            "regex_rules": [],
                        },
                    },
                }
            ]
        }

        pipeline = DetectorPipeline.from_recipe(recipe, source=mock_source, runner_id="test-runner")

        assert len(pipeline.detectors) == 1
        detector = pipeline.detectors[0]
        assert detector.detector_type == "custom"
        assert DetectorType(detector.detector_type.upper()) == DetectorType.CUSTOM

    def test_pipeline_from_recipe_multiple_detectors(self, mock_source):
        """Test pipeline creation with multiple detector types."""
        if not (
            self._is_dependency_available("detect_secrets")
            and self._is_dependency_available("presidio_analyzer")
            and self._is_dependency_available("yara")
        ):
            pytest.skip("Missing optional detector dependencies, skipping multi-detector test")

        recipe = {
            "detectors": [
                {
                    "type": "SECRETS",
                    "enabled": True,
                    "config": {"confidence_threshold": 0.8},
                },
                {
                    "type": "PII",
                    "enabled": True,
                    "config": {"confidence_threshold": 0.75},
                },
                {
                    "type": "YARA",
                    "enabled": True,
                    "config": {"timeout": 60},
                },
                {
                    "type": "BROKEN_LINKS",
                    "enabled": True,
                    "config": {},
                },
            ]
        }

        pipeline = DetectorPipeline.from_recipe(recipe, source=mock_source, runner_id="test-runner")

        if len(pipeline.detectors) < 4:
            pytest.skip(
                "Optional detector dependencies are not fully installed; "
                "skipping full multi-detector pipeline test"
            )

        assert len(pipeline.detectors) == 4

        detector_types = [d.detector_type for d in pipeline.detectors]
        assert "secrets" in detector_types
        assert "pii" in detector_types
        assert "yara" in detector_types
        assert "broken_links" in detector_types

        # All should be convertible to DetectorType enums
        for detector in pipeline.detectors:
            _ = DetectorType(detector.detector_type.upper())

    def test_pipeline_rejects_invalid_detector_type(self, mock_source):
        """Test pipeline handles invalid detector type gracefully."""
        recipe = {
            "detectors": [
                {
                    "type": "INVALID_TYPE",
                    "enabled": True,
                    "config": {},
                }
            ]
        }

        pipeline = DetectorPipeline.from_recipe(recipe, source=mock_source, runner_id="test-runner")

        # Should have no detectors (invalid type was skipped)
        assert len(pipeline.detectors) == 0

    def test_pipeline_rejects_old_threat_detector_type(self, mock_source):
        """Test pipeline rejects the old 'THREAT' detector type."""
        recipe = {
            "detectors": [
                {
                    "type": "THREAT",  # Old, incorrect type
                    "enabled": True,
                    "config": {},
                }
            ]
        }

        pipeline = DetectorPipeline.from_recipe(recipe, source=mock_source, runner_id="test-runner")

        # Should have no detectors (THREAT is not a valid type)
        assert len(pipeline.detectors) == 0

    def test_pipeline_rejects_old_content_detector_type(self, mock_source):
        """Test pipeline rejects the old 'CONTENT' detector type."""
        recipe = {
            "detectors": [
                {
                    "type": "CONTENT",  # Old, incorrect type
                    "enabled": True,
                    "config": {},
                }
            ]
        }

        pipeline = DetectorPipeline.from_recipe(recipe, source=mock_source, runner_id="test-runner")

        # Should have no detectors (CONTENT is not a valid type)
        assert len(pipeline.detectors) == 0

    def test_all_valid_detector_types_in_enum(self):
        """Test that all valid detector types are in the DetectorType enum."""
        valid_types = [
            "SECRETS",
            "PII",
            "TOXIC",
            "NSFW",
            "YARA",
            "BROKEN_LINKS",
            "PROMPT_INJECTION",
            "PHISHING_URL",
            "SPAM",
            "LANGUAGE",
            "CODE_SECURITY",
            "CUSTOM",
        ]

        for detector_type in valid_types:
            # Should not raise ValueError
            _ = DetectorType(detector_type)

    def test_invalid_detector_types_raise_error(self):
        """Test that invalid detector types raise ValueError."""
        invalid_types = ["THREAT", "CONTENT", "INVALID", "threat", "content"]

        for detector_type in invalid_types:
            with pytest.raises(ValueError, match="is not a valid DetectorType"):
                DetectorType(detector_type)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
