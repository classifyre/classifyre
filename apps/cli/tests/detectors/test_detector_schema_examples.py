"""Test that all detector schema examples are valid."""

import json
from pathlib import Path

import pytest

from src.models.generated_detectors import (
    BrokenLinksDetectorConfig,
    ContentDetectorConfig,
    ContentEnabledPattern,
    ContentModelName,
    CustomDetectorConfig,
    DetectorConfig,
    DetectorType,
    PIIDetectorConfig,
    PIIEnabledPattern,
    SecretsDetectorConfig,
    SecretsEnabledPattern,
    ThreatDetectorConfig,
)


class TestDetectorSchemaExamples:
    """Test that all examples in all_detectors_examples.json are valid."""

    @pytest.fixture
    def examples(self) -> dict:
        """Load detector examples from JSON file."""
        # Navigate from tests/detectors to packages/schemas
        repo_root = Path(__file__).parent.parent.parent.parent.parent
        examples_path = (
            repo_root / "packages" / "schemas" / "src" / "schemas" / "all_detectors_examples.json"
        )

        with open(examples_path) as f:
            return json.load(f)

    def test_secrets_examples_are_valid(self, examples: dict):
        """Test all SECRETS examples validate against SecretsDetectorConfig."""
        secrets_examples = examples.get("SECRETS", [])
        assert len(secrets_examples) > 0, "No SECRETS examples found"

        for example in secrets_examples:
            config_data = example.get("config", {})
            # This should not raise validation errors
            config = SecretsDetectorConfig.model_validate(config_data)
            assert config is not None

            # Verify enabled_patterns if present
            if config.enabled_patterns:
                valid_patterns = {pattern.value for pattern in SecretsEnabledPattern}
                for pattern in config.enabled_patterns:
                    assert pattern.value in valid_patterns, f"Invalid pattern: {pattern}"

    def test_pii_examples_are_valid(self, examples: dict):
        """Test all PII examples validate against PIIDetectorConfig."""
        pii_examples = examples.get("PII", [])
        assert len(pii_examples) > 0, "No PII examples found"

        for example in pii_examples:
            config_data = example.get("config", {})
            # This should not raise validation errors
            config = PIIDetectorConfig.model_validate(config_data)
            assert config is not None

            # Verify enabled_patterns if present
            if config.enabled_patterns:
                valid_patterns = {pattern.value for pattern in PIIEnabledPattern}
                for pattern in config.enabled_patterns:
                    assert pattern.value in valid_patterns, f"Invalid pattern: {pattern}"

    def test_toxic_examples_are_valid(self, examples: dict):
        """Test all TOXIC examples validate against ContentDetectorConfig."""
        toxic_examples = examples.get("TOXIC", [])
        assert len(toxic_examples) > 0, "No TOXIC examples found"

        for example in toxic_examples:
            config_data = example.get("config", {})
            # This should not raise validation errors
            config = ContentDetectorConfig.model_validate(config_data)
            assert config is not None

            # Verify enabled_patterns if present
            if config.enabled_patterns:
                valid_patterns = {pattern.value for pattern in ContentEnabledPattern}
                for pattern in config.enabled_patterns:
                    assert pattern.value in valid_patterns, f"Invalid pattern: {pattern}"

            # Verify model_name if present
            if config.model_name:
                valid_models = {model.value for model in ContentModelName}
                assert config.model_name.value in valid_models, (
                    f"Invalid model_name: {config.model_name}"
                )

    def test_nsfw_examples_are_valid(self, examples: dict):
        """Test all NSFW examples validate against ContentDetectorConfig."""
        nsfw_examples = examples.get("NSFW", [])
        assert len(nsfw_examples) > 0, "No NSFW examples found"

        for example in nsfw_examples:
            config_data = example.get("config", {})
            # This should not raise validation errors
            config = ContentDetectorConfig.model_validate(config_data)
            assert config is not None

            # Verify enabled_patterns if present
            if config.enabled_patterns:
                valid_patterns = {pattern.value for pattern in ContentEnabledPattern}
                for pattern in config.enabled_patterns:
                    assert pattern.value in valid_patterns, f"Invalid pattern: {pattern}"

    def test_yara_examples_are_valid(self, examples: dict):
        """Test all YARA examples validate against ThreatDetectorConfig."""
        yara_examples = examples.get("YARA", [])
        assert len(yara_examples) > 0, "No YARA examples found"

        for example in yara_examples:
            config_data = example.get("config", {})
            # This should not raise validation errors
            config = ThreatDetectorConfig.model_validate(config_data)
            assert config is not None

            # Verify timeout is reasonable
            if config.timeout:
                assert 1 <= config.timeout <= 600, (
                    f"Timeout should be between 1 and 600 seconds, got {config.timeout}"
                )

            # Verify max_findings is positive
            if config.max_findings:
                assert config.max_findings > 0, (
                    f"max_findings should be positive, got {config.max_findings}"
                )

    def test_broken_links_examples_are_valid(self, examples: dict):
        """Test all BROKEN_LINKS examples validate against BrokenLinksDetectorConfig."""
        broken_links_examples = examples.get("BROKEN_LINKS", [])
        assert len(broken_links_examples) > 0, "No BROKEN_LINKS examples found"

        for example in broken_links_examples:
            config_data = example.get("config", {})
            config = BrokenLinksDetectorConfig.model_validate(config_data)
            assert config is not None

    def test_prompt_injection_examples_are_valid(self, examples: dict):
        """Test all PROMPT_INJECTION examples validate against DetectorConfig."""
        prompt_injection_examples = examples.get("PROMPT_INJECTION", [])
        assert len(prompt_injection_examples) > 0, "No PROMPT_INJECTION examples found"

        for example in prompt_injection_examples:
            config_data = example.get("config", {})
            config = DetectorConfig.model_validate(config_data)
            assert config is not None

    def test_spam_examples_are_valid(self, examples: dict):
        """Test all SPAM examples validate against DetectorConfig."""
        spam_examples = examples.get("SPAM", [])
        assert len(spam_examples) > 0, "No SPAM examples found"

        for example in spam_examples:
            config_data = example.get("config", {})
            config = DetectorConfig.model_validate(config_data)
            assert config is not None

    def test_language_examples_are_valid(self, examples: dict):
        """Test all LANGUAGE examples validate against DetectorConfig."""
        language_examples = examples.get("LANGUAGE", [])
        assert len(language_examples) > 0, "No LANGUAGE examples found"

        for example in language_examples:
            config_data = example.get("config", {})
            config = DetectorConfig.model_validate(config_data)
            assert config is not None

    def test_code_security_examples_are_valid(self, examples: dict):
        """Test all CODE_SECURITY examples validate against DetectorConfig."""
        code_security_examples = examples.get("CODE_SECURITY", [])
        assert len(code_security_examples) > 0, "No CODE_SECURITY examples found"

        for example in code_security_examples:
            config_data = example.get("config", {})
            config = DetectorConfig.model_validate(config_data)
            assert config is not None

    def test_custom_examples_are_valid(self, examples: dict):
        """Test all CUSTOM examples validate against CustomDetectorConfig."""
        custom_examples = examples.get("CUSTOM", [])
        assert len(custom_examples) > 0, "No CUSTOM examples found"

        for example in custom_examples:
            config_data = example.get("config", {})
            config = CustomDetectorConfig.model_validate(config_data)
            assert config is not None

    def test_all_example_types_exist(self, examples: dict):
        """Test that examples exist for all detector types."""
        expected_types = {detector_type.value for detector_type in DetectorType}
        actual_types = set(examples.keys())
        assert actual_types == expected_types, (
            f"Missing or extra detector types. Expected: {expected_types}, Actual: {actual_types}"
        )

    def test_all_examples_have_required_fields(self, examples: dict):
        """Test that all examples have name, description, and config fields."""
        for detector_type, detector_examples in examples.items():
            for i, example in enumerate(detector_examples):
                assert "name" in example, f"{detector_type} example {i} missing 'name' field"
                assert "description" in example, (
                    f"{detector_type} example {i} missing 'description' field"
                )
                assert "config" in example, f"{detector_type} example {i} missing 'config' field"

                # Verify name and description are non-empty strings
                assert isinstance(example["name"], str) and len(example["name"]) > 0
                assert isinstance(example["description"], str) and len(example["description"]) > 0
                assert isinstance(example["config"], dict)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
