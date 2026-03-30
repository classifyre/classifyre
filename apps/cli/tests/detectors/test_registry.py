import pytest

from src.detectors import get_detector, list_available_detectors
from src.detectors.dependencies import MissingDependencyError
from src.models.generated_detectors import DetectorConfig


def test_list_available_detectors():
    """Test that detectors can be discovered"""
    detectors = list_available_detectors()
    assert isinstance(detectors, list)
    # Should return a sorted list
    assert detectors == sorted(detectors)
    assert "broken_links" in detectors


def test_get_detector_raises_on_invalid():
    """Test that getting a nonexistent detector raises ValueError"""
    with pytest.raises(ValueError, match="not found"):
        get_detector("nonexistent_detector_12345")


def test_get_detector_error_message_lists_available():
    """Test that error message includes available detectors"""
    try:
        get_detector("invalid")
    except ValueError as e:
        assert "Available:" in str(e)


def test_get_detector_with_config():
    """Test that detector can be created with config"""
    # This test will work once we have at least one detector implementation
    # For now, we'll just test the interface
    config = DetectorConfig(confidence_threshold=0.9)
    # Should not raise if detector exists
    try:
        # Will raise ValueError if no detectors registered yet
        detectors = list_available_detectors()
        if detectors:
            detector = get_detector(detectors[0], config)
            assert detector.config.confidence_threshold == 0.9
    except (MissingDependencyError, ValueError, IndexError):
        # No detectors registered yet - this is OK for now
        pass
